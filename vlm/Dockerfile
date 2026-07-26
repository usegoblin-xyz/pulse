# Pulse's self-hosted vision model: SmolVLM2-2.2B (an efficient VLM) served by
# llama.cpp's OpenAI-compatible server, on CPU. No API fees, no rate limits —
# Pulse's eyes run on our own Fly machine. Weights are baked into the image so
# cold starts don't re-download every time. SmolVLM is an official ggml-org
# build (template + projector work natively) and uses far fewer image tokens
# than moondream, so CPU inference is much faster.

# --- stage 1: fetch the GGUF weights (Q4 model + the quantized projector) ---
FROM alpine:3.20 AS models
RUN apk add --no-cache curl
WORKDIR /models
RUN curl -fSL -o model.gguf \
      https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf \
 && curl -fSL -o mmproj.gguf \
      https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf \
 && ls -lh /models

# --- stage 2: the llama.cpp server (CPU build) with the weights inside ---
FROM ghcr.io/ggml-org/llama.cpp:server
COPY --from=models /models /models

# The image's ENTRYPOINT is the llama-server binary; it reads these LLAMA_ARG_*
# env vars, so no CMD is needed. --mmproj turns on vision.
ENV LLAMA_ARG_MODEL=/models/model.gguf \
    LLAMA_ARG_MMPROJ=/models/mmproj.gguf \
    LLAMA_ARG_HOST=0.0.0.0 \
    LLAMA_ARG_PORT=8080 \
    LLAMA_ARG_CTX_SIZE=4096 \
    LLAMA_ARG_THREADS=2

EXPOSE 8080
