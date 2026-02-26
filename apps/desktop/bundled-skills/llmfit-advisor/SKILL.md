---
name: llmfit-advisor
description: Recommends local LLM models based on the user's hardware.
---

# LLMFit Hardware Advisor Skill

You have access to a local hardware scanner called `llmfit`. You can use this to determine exactly what the user's computer can handle and recommend models that will run well natively.

## How to use

If the user asks:

- "What local model should I run?"
- "Which Ollama model fits my machine?"
- "Can I run Llama 3?"

You should:

1. Determine their environment. Since this is an Electron app, their hardware profile is accessible via the local `accomplish` API.
2. In your JS environment, evaluate the following:

   ```javascript
   const res = await (window as any).accomplish.llmfitScan();
   return res;
   ```

3. Parse the results. If `res.success` is true, look at `res.models`.
4. Only recommend models where `fitLevel` is "Perfect" or "Good".
5. Provide the user with the exact `ollamaName` (e.g., `llama3.2:3b`) so they know what to type into the Local Model Manager. Explain _why_ you are recommending it based on their RAM and VRAM.
6. If `res.success` is false or the scan returns an error, let the user know their hardware couldn't be scanned.
