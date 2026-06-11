# UNIT-01 Local LLM Hardware & Compatibility Guide

This guide provides an unbiased, hardware-driven compatibility map for running local AI coding models inside the **UNIT-01** agentic loop. 

Running agentic loops (where the model plan-writes-compiles-fixes in cycles) requires a fine balance of **token-generation speed (latency)**, **reasoning capacity (intelligence)**, and **memory safety (avoiding system swap)**.

---

## 1. The Core Memory Math: Model Weights + KV Cache

When choosing a model, your total memory footprint is:
$$\text{Total Memory} = \text{Model Weight Size} + \text{KV Cache Size} + \text{System Overhead (1-2 GB)}$$

### GGUF Model Weight Footprint (Estimates)
| Parameter Size | Q4_K_M (4-bit) | Q5_K_M (5-bit) | Q8_0 (8-bit) |
| :--- | :--- | :--- | :--- |
| **1.5B–3B** | ~1.5 GB - 2.5 GB | ~1.8 GB - 3.0 GB | ~2.5 GB - 4.0 GB |
| **7B–9B** | ~4.5 GB - 5.5 GB | ~5.5 GB - 6.5 GB | ~8.0 GB - 9.5 GB |
| **12B–14B** | ~7.5 GB - 9.0 GB | ~9.0 GB - 11.0 GB | ~13.0 GB - 15.0 GB |
| **30B–35B** (or MoE) | ~18.0 GB - 22.0 GB | ~21.0 GB - 25.0 GB | ~32.0 GB - 35.0 GB |

### The KV Cache Cost (Context Overhead)
As the agent’s chat history and code files load into the context window, memory usage grows dynamically. 
* **8K Context:** Requires an extra **~0.8 GB - 1.5 GB** of memory.
* **32K Context:** Requires an extra **~3.0 GB - 5.5 GB** of memory (depending on architecture).
* *Rule of Thumb:* Always leave at least **2.0 GB** of RAM free for the KV cache and background OS operations (Chrome, Slack, VS Code).

---

## 2. Hardware Tiers & Model Recommendations

### 🟢 Tier 1: 8 GB Unified Memory (Base Mac / Entry PC)
* **Strategy:** Keep memory footprint extremely small to prevent system swapping. Limit context to 8K.
* **Compatibility Profile:**
  * **Qwen 2.5 Coder 1.5B (Instruct, Q5_K_M or Q8_0):** ~1.5 GB to 2.5 GB RAM. Extremely fast (50+ tokens/sec). Very reliable tool-calling for basic scripts and simple website files.
  * **Llama 3.2 3B (Instruct, Q4_K_M):** ~2.2 GB RAM. Good general reasoning, though tool calling can occasionally slip on multi-step plans.
  * **DeepSeek Coder 1.3B (Q8_0):** ~1.6 GB RAM. Highly performant single-file coding.
* **UNIT-01 Fit:** Excellent for fast, single-file autocomplete, quick explanations, and lightweight folder inspects.

---

### 🟡 Tier 2: 16 GB Unified Memory (Standard Air/Pro / Mid-Tier PC)
* **Strategy:** Run high-capability dense coding models up to 32K context. Keep model weights under 7 GB.
* **Compatibility Profile:**
  * **Qwen 2.5 Coder 7B / Qwen 3.5 9B (Q4_K_M):** ~4.8 GB to 5.5 GB RAM. The absolute sweet spot for local agents. Native tool-calling capability is rock-solid, and it rarely makes syntax errors.
  * **Google Gemma 4 12B (Q4_K_M):** ~7.8 GB RAM. Excellent logic and instruction-following, though runs close to the memory boundary if context fills up.
  * **Llama 3.1 8B (Instruct, Q5_K_M):** ~6.1 GB RAM. Highly robust, though slightly less specialized for programming syntax than Qwen-Coder.
* **UNIT-01 Fit:** The ideal tier for daily vibecoding. Fully supports compiling, dependency installations, and loop self-correction.

---

### 🔵 Tier 3: 24 GB – 32 GB Unified Memory (Pro Machine / High-End PC)
* **Strategy:** Run large-reasoning coding models up to 64K context with high quantizations.
* **Compatibility Profile:**
  * **Qwen 2.5 Coder 32B (Q4_K_M):** ~20 GB RAM. Outstanding reasoning capabilities. Close to commercial cloud APIs (GPT-4/Claude) in code logic. Highly accurate multi-file edits.
  * **Mistral Codestral 22B (Q4_K_M):** ~14 GB RAM. Large context window, optimized specifically for codebase analysis and repository tasks.
  * **Google Gemma 4 12B (Q8_0):** ~13 GB RAM. Full-precision small model logic.
* **UNIT-01 Fit:** High-level autonomy. Can refactor multiple files, write structural test cases, and solve complex compilation issues.

---

### 🔴 Tier 4: 64 GB+ Unified Memory (Max Studio / Workstation)
* **Strategy:** Run un-quantized or large parameter models (up to 70B+) with massive context boundaries (128K).
* **Compatibility Profile:**
  * **Qwen 2.5 Coder 32B (Q8_0 or FP16):** ~32 GB to 64 GB RAM. Unrivaled local precision.
  * **DeepSeek Coder 33B (Q8_0):** ~35 GB RAM. Highly structured output, great for system architecture.
  * **Llama 3.1 70B (Instruct, Q4_K_M):** ~42 GB RAM. Extremely deep reasoning, though slower token generation.
* **UNIT-01 Fit:** Enterprise-scale agent loops. Can process large sections of the codebase map simultaneously.

---

## 3. General Best Practices for Local Agents
1. **Always choose "Coder" or "Instruct" variants:** Base models are not trained for tool calling or conversational instruction. They will fail to emit the structured JSON required by UNIT-01's tools.
2. **Format Settings:** Use **Q4_K_M** GGUF quantizations as your starting point. Going below 4-bit (e.g. Q2) severely damages the model's logic capabilities, causing tool-loop failure.
3. **Heat Management:** If running on a fanless machine (like a MacBook Air), long agentic loops will trigger thermal throttling, slowing down generation speed. Keep the tasks scoped and granular to avoid long running times.
