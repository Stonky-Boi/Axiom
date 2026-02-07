interface OllamaResponse {
  response?: string;
  // Add other properties if needed (e.g., done, context, etc.)
}

export async function generateCompletion(prompt: string) {
  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:1.5b", // Ensure this matches your local model
        prompt,
        stream: false,
        raw: true,
        options: {
          temperature: 0.2,
          num_predict: 150,
          repeat_penalty: 1.1,
          stop: [
            "\n# Test", "\nprint(", "\n# Example", "\nif __name__",
            "\n\ndef ", "\n\nclass ", "\n\n\n"
          ]
        }
      })
    });

    if (!res.ok) {
      console.error(`Ollama Error: ${res.status} ${res.statusText}`);
      return "";
    }

    // FIX: Cast the response to our interface
    const json = (await res.json()) as OllamaResponse;
    return json.response ?? "";

  } catch (error) {
    console.error("Ollama Connection Failed:", error);
    return "";
  }
}