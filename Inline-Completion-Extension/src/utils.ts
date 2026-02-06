export function cleanCompletion(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // normalizing line endings 
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  //Remove markdown code blocks
  cleaned = cleaned
    .replace(/^```[\w]*\n?/g, "")
    .replace(/\n?```$/g, "")
    .replace(/```/g, "");

  //Remove conversational prefixes
  const conversationalPrefixes = [
    /^(Sure|Certainly|Here'?s?|Below is|This is|The code|I'll|Let me).*?\n/i,
    /^.*?:\s*\n/, 
  ];

  for (const pattern of conversationalPrefixes) {
    cleaned = cleaned.replace(pattern, "");
  }

  //Split into lines and stop at test/example code markers
  const lines = cleaned.split('\n');
  const resultLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Python-style test markers 
    if (trimmed.startsWith('#') &&
        (trimmed.includes('Test') || trimmed.includes('Example') || trimmed.includes('Output'))) {
      break;
    }
    if (trimmed.startsWith('print(')) break;
    if (trimmed.includes('__name__') && trimmed.includes('__main__')) break;

    // C-style test markers (C++, Java, C#, JS/TS) 
    if (/^\/\/\s*(Test|Example|Output|Usage|Main)/i.test(trimmed)) break;
    if (/^\/\*\s*(Test|Example|Output|Usage|Main)/i.test(trimmed)) break;

    if (/^(public\s+static\s+)?(void\s+)?main\s*\(/.test(trimmed)) break;

    // Java or Cpp 
    if (trimmed === "@Test" || trimmed.startsWith("@Test(")) break;

    if (trimmed.startsWith('cout <<') || trimmed.startsWith('System.out.println')) break;

    if (resultLines.length > 0 && trimmed.length > 20) {
      const hasSyntax = /[;{}()\[\]=<>]/.test(trimmed);
      const startsWithCapital = /^[A-Z]/.test(trimmed);
      const looksLikeProse = startsWithCapital && !hasSyntax;
      if (looksLikeProse) {
        console.log("🚫 Stopped at prose line: " + trimmed.substring(0, 40));
        break;
      }
    }

    resultLines.push(line);
  }

  cleaned = resultLines.join('\n').trimEnd();

  //Remove trailing comment-only lines
  const finalLines = cleaned.split('\n');
  const codeLines: string[] = [];

  for (const line of finalLines) {
    const trimmed = line.trim();

    if (codeLines.length > 0) {
      const lastCodeLine = codeLines[codeLines.length - 1].trim();
      const isComment = trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/*');
      const lastWasCode = lastCodeLine && !lastCodeLine.startsWith('#') && !lastCodeLine.startsWith('//');

      if (isComment && lastWasCode) {
        break;
      }
    }

    codeLines.push(line);
  }

  return codeLines.join('\n').trimEnd();
}