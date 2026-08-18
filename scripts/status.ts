#!/usr/bin/env bun
/** Print a project's current state. Usage: bun run scripts/status.ts <projectId> */
const id = process.argv[2]
const res = await fetch(`http://localhost:4000/api/projects/${id}`)
const { project, issues, events } = (await res.json()) as {
  project: any
  issues: any[]
  events: any[]
}

console.log(`\nproject : ${project.name}  [${project.status}]`)
console.log(`preview : ${project.previewUrl ?? '(booting)'}`)
console.log(`\nissues:`)
for (const i of issues) {
  console.log(`  wave ${i.wave}  #${i.number}  [${i.status.padEnd(8)}]  ${i.title}`)
  if (i.paths.length) console.log(`           ${i.paths.join(', ')}`)
  if (i.error) console.log(`           ! ${i.error}`)
}

console.log(`\nrecent activity:`)
for (const e of events.slice(-16)) {
  if (e.type === 'log') console.log(`  ${e.payload?.message}`)
  else if (e.type === 'issue_status') console.log(`  issue → ${e.payload?.status}`)
  else if (e.type === 'wave_start') console.log(`  ── wave ${e.payload.wave} start (${e.payload.count} issues)`)
  else if (e.type === 'wave_end') console.log(`  ── wave ${e.payload.wave} done`)
}
