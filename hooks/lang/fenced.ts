// Pasted tool output goes in a text fence it cannot close, so the drafted prompt reads it as data.
export function fenced(text: string): string {
  return `\`\`\`text\n${text.replace(/`{3,}/g, "'''")}\n\`\`\``
}
