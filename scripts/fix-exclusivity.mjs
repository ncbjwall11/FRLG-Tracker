/**
 * Fix exclusivity flags in frlg-pokemon.json
 *
 * getVersionExclusivity() in fetch-data.mjs only checks the manual override
 * list and defaults everything else to 'both', ignoring actual encounter data.
 *
 * This script re-derives exclusivity for every Pokémon:
 *   1. Manual versionExclusives list takes priority (unchanged)
 *   2. If not in manual list and has encounters → derive from encounter versions
 *   3. If no encounters → inherit from parent (walk up evolution chain)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { manualData, versionExclusives } from '../src/data/frlg-manual.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JSON_PATH = path.join(__dirname, '../src/data/frlg-pokemon.json')

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'))
const pokemon = raw.pokemon

// Build parent-lookup map from the JSON evolution comments embedded in names
// We derive it from versionExclusives + encounter data, not needing evolutions.js.
// Parse evolutionData from evolutions.js via dynamic import instead.
const evoSrc = fs.readFileSync(
  path.join(__dirname, '../src/data/evolutions.js'), 'utf-8'
)
// Extract the evolutionData object literal and evaluate it safely
const evoMatch = evoSrc.match(/export const evolutionData\s*=\s*(\{[\s\S]*?\n\})/)
if (!evoMatch) { console.error('Could not parse evolutionData'); process.exit(1) }
// eslint-disable-next-line no-eval
const evolutionData = eval('(' + evoMatch[1] + ')')
// evolutionData[evolvedId] = { from: parentId, ... }

// Build id→pokemon lookup
const byId = Object.fromEntries(pokemon.map(p => [p.id, p]))

// Step 1: derive exclusivity from encounters for all Pokémon
function fromEncounters(p) {
  if (p.encounters.length === 0) return null
  const versions = new Set(p.encounters.map(e => e.versions))
  if (versions.size === 1) {
    const v = [...versions][0]
    if (v === 'firered' || v === 'leafgreen') return v
  }
  return 'both'
}

// Step 2: walk up evolution chain to inherit exclusivity
function inheritedExclusivity(id, visited = new Set()) {
  if (visited.has(id)) return 'both' // cycle guard
  visited.add(id)
  const evo = evolutionData[id]
  if (!evo) return null // no parent known
  const parent = byId[evo.from]
  if (!parent) return null
  // Try parent's encounter-derived exclusivity first
  const fromEnc = fromEncounters(parent)
  if (fromEnc) return fromEnc
  // Parent also has no encounters — keep climbing
  return inheritedExclusivity(evo.from, visited)
}

let changed = 0

for (const p of pokemon) {
  const manualFR = versionExclusives.firered.includes(p.id)
  const manualLG = versionExclusives.leafgreen.includes(p.id)

  let correct
  if (manualFR) {
    correct = 'firered'
  } else if (manualLG) {
    correct = 'leafgreen'
  } else {
    // Try encounter data first
    correct = fromEncounters(p)
    // Fall back to inheriting from parent
    if (!correct) correct = inheritedExclusivity(p.id) ?? 'both'
  }

  if (p.exclusivity !== correct) {
    console.log(`  #${String(p.id).padStart(3,'0')} ${p.name}: '${p.exclusivity}' → '${correct}'`)
    p.exclusivity = correct
    changed++
  }
}

fs.writeFileSync(JSON_PATH, JSON.stringify(raw, null, 2))
console.log(`\nDone. Fixed ${changed} Pokémon.`)
