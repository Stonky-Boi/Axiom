export function cleanCompletion(text: string): string {
  if (!text) {return "";}

  let cleaned = text;

  // 1. Markdown Fences
  cleaned = cleaned.replace(/```[\w]*\n?/g, "").replace(/```/g, "");

  // 2. Stop Sequences (Manual lines)
  const lines = cleaned.split('\n');
  const resultLines: string[] = [];
  
  for (const line of lines) {
    // Stop at common prompt leakage
    if (line.trim().startsWith("# Test") || line.trim().startsWith("// Test")) {break;}
    if (line.includes("if __name__ ==")) {break;}
    
    resultLines.push(line);
  }
  
  // 3. Join back. DO NOT .trim() the start, as indentation matters!
  // Only trim the End.
  return resultLines.join('\n').trimEnd();
}