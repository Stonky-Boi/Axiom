export async function generateCompletion(prompt: string) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-coder:1.5b",
      prompt,
      stream: false,
      raw: true, 
      
      options: {
        temperature: 0.2,
        num_predict: 150,       
        repeat_penalty: 1.1,
        
        //Required Stops
        stop: [
          "\n# Test",           
          "\nprint(",           
          "\n# Example",        
          "\nif __name__",      
          "\n\ndef ",           
          "\n\nclass ",         
          "\n\n\n",             
        ]
      }
    })
  });

  const json = await res.json();
  return json.response ?? "";
}