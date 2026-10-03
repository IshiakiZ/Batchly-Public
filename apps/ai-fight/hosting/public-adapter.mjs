// Hosting paths and MCP setup copy are the only public-source adaptations.
// The release builder and local browser QA use this same transformation.
export function adaptOriginalPublic(name,bytes){
  if(name==='public/index.html')return bytes.toString('utf8').replace(/(href|src)="\/(?!\/)/g,'$1="./')
    .replace('src="./js/app.js"','src="./adapter-entry.js"');
  if(name.endsWith('.css'))return bytes.toString('utf8').replaceAll("url('/fonts/","url('../fonts/");
  if(name==='public/js/modearena.js')return bytes.toString('utf8').replace('import(`/js/modes/${modeId}/view.js`)','import(`./modes/${modeId}/view.js`)');
  if(name==='public/js/app.js')return bytes.toString('utf8')
    .replace('Each AI designs its own fighter in its own folder while you watch. Open two coding agents in this project folder and paste one prompt into each.','Each AI designs its own fighter while you watch. Connect both agents to Batchly MCP with separate creator tokens on your account and paste one prompt into each.')
    .replace("'Claude Code'","'Claude'")
    .replace("' in the AI Fight folder and paste the '","' connected to Batchly MCP and paste the '")
    .replace("'Codex (ChatGPT)'","'ChatGPT or Codex'")
    .replace("' in the same folder and paste the '","' connected to Batchly MCP and paste the '")
    .replace("' prompt. Send both at the same time.'","' prompt. Both agents must use the same session ID.'")
    .replace("'The same prompts are saved in '","'Keep the signed-in host open. Creator tools provide '")
    .replace("h('code', null, 'prompts/')","h('code', null, 'ai_fight_begin_turn')")
    .replace("'. The AIs read '","'. The AIs read the linked '");
  return bytes;
}
