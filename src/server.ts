import express from "express";
import dotenv from "dotenv";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { promises as fsPromises } from "fs";
import EventEmitter from "events";

dotenv.config();

const app = express();
const port = process.env.PORT || 5566;
const serverAddress = process.env.COMFYUI_SERVER_ADDRESS || "localhost:8188";

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

app.use(express.json());

// Add this global map to store message handlers for each request
const messageHandlers = new Map<string, EventEmitter>();

// Add this function at the top of your file, after the imports
function getRandomSeed(): number {
  return Math.floor(Math.random() * 1000000000) + 1;
}

// Queue prompt function
async function queuePrompt(prompt: any): Promise<any> {
  const clientId = uuidv4();
  const p = { prompt, client_id: clientId };
  const data = JSON.stringify(p);

  console.log(`Sending prompt to ${serverAddress}/prompt`);
  // Remove logging of entire prompt data
  // console.log(`Prompt data: ${data}`);

  try {
    const response = await fetch(`http://${serverAddress}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log(
      `Received response from prompt queue: ${JSON.stringify(result)}`
    );
    return result;
  } catch (error) {
    console.error("Error queueing prompt:", error);
    throw error;
  }
}

// Get image function
async function getImage(
  filename: string,
  subfolder: string,
  folderType: string
): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type: folderType });
  const url = `http://${serverAddress}/view?${params}`;
  console.log(`Fetching image from URL: ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    console.log(
      `Image fetched successfully, size: ${arrayBuffer.byteLength} bytes`
    );
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Error fetching image from ${url}:`, error);
    throw error;
  }
}

// Get history for a prompt ID
async function getHistory(promptId: string): Promise<any> {
  const response = await fetch(`http://${serverAddress}/history/${promptId}`);
  return response.json();
}

// Load workflow JSON at startup
let workflowJson: any;

async function loadWorkflow() {
  try {
    const workflowData = await readFileAsync(
      path.join(__dirname, "..", "cn_img2img_v2.json"),
      "utf-8"
    );
    workflowJson = JSON.parse(workflowData);
    console.log("Workflow JSON loaded successfully");
  } catch (error) {
    console.error("Error loading workflow JSON:", error);
    process.exit(1);
  }
}

loadWorkflow();

// New function to save images
async function saveImages(
  images: { [key: string]: Buffer[] },
  seed: number
): Promise<string[]> {
  const outputDir = path.join(__dirname, "..", "output");
  console.log(`Attempting to create/access output directory: ${outputDir}`);
  await fsPromises.mkdir(outputDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const [nodeId, buffers] of Object.entries(images)) {
    for (let i = 0; i < buffers.length; i++) {
      const filename = `${nodeId}-${seed}-${i}.png`;
      const filePath = path.join(outputDir, filename);
      console.log(`Attempting to save image: ${filePath}`);
      try {
        await fsPromises.writeFile(filePath, buffers[i]);
        savedPaths.push(filePath);
        console.log(`Successfully saved image: ${filePath}`);
      } catch (error) {
        console.error(`Error saving image ${filePath}:`, error);
      }
    }
  }

  console.log(`Saved ${savedPaths.length} images to ${outputDir}`);
  return savedPaths;
}

// Update the encodeImageToBase64 function
async function encodeImageToBase64(imagePath: string): Promise<string> {
  const imageBuffer = await fsPromises.readFile(imagePath);
  const base64 = imageBuffer.toString("base64");
  return `data:image/png;base64,${base64}`;
}

// Test generate images function
app.post("/test-generate-images", async (req, res) => {
  try {
    console.log("Starting test-generate-images...");
    const { positivePrompt, negativePrompt } = req.body;

    if (!positivePrompt || !negativePrompt) {
      console.error("Missing prompts:", { positivePrompt, negativePrompt });
      return res.status(400).json({
        error: "Both positive and negative prompts are required",
        receivedPositive: !!positivePrompt,
        receivedNegative: !!negativePrompt,
      });
    }

    console.log(`Received positive prompt: ${positivePrompt}`);
    console.log(`Received negative prompt: ${negativePrompt}`);

    // Use the pre-loaded workflow without modifications
    const workflow = JSON.parse(JSON.stringify(workflowJson));
    console.log(`Workflow JSON cloned`);

    // Set the input image path (use absolute path)
    const inputImagePath = path.resolve(__dirname, "..", "input", "lukso.png");
    console.log(`Using input image path: ${inputImagePath}`);

    // Check if the file exists
    if (!fs.existsSync(inputImagePath)) {
      throw new Error(`Input image not found: ${inputImagePath}`);
    }

    // Update the image input in the workflow with the file path
    workflow["13"]["inputs"]["image"] = inputImagePath;

    // Ensure the LoadImage node is configured correctly
    workflow["13"]["class_type"] = "LoadImage";

    // Set a random seed
    workflow["3"]["inputs"]["seed"] = getRandomSeed();
    console.log(`Using random seed: ${workflow["3"]["inputs"]["seed"]}`);

    // Set positive and negative prompts
    workflow["6"]["inputs"]["text"] = positivePrompt;
    workflow["7"]["inputs"]["text"] = negativePrompt;

    console.log("Final workflow JSON:");
    console.log(JSON.stringify(workflow, null, 2));

    const result = await new Promise((resolve, reject) => {
      imageGenerationQueue.enqueue({ resolve, reject, workflow });
      processQueue(); // Start processing the queue if it's not already processing
    });

    console.log(`Images generated, sending response...`);
    res.json(result);
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating test images" });
  }
});

// Add this class after the imports and before the existing code

class Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}

// Create a queue for image generation requests
const imageGenerationQueue = new Queue<{
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  workflow: any;
}>();

// Flag to track if a request is currently being processed
let isProcessingRequest = false;

// Function to process the queue
async function processQueue() {
  if (isProcessingRequest || imageGenerationQueue.isEmpty()) {
    return;
  }

  isProcessingRequest = true;
  const request = imageGenerationQueue.dequeue();

  if (!request) {
    isProcessingRequest = false;
    return;
  }

  try {
    const result = await generateImage(request.workflow);
    request.resolve(result);
  } catch (error) {
    request.reject(error);
  } finally {
    isProcessingRequest = false;
    processQueue(); // Process the next request in the queue
  }
}

// Function to generate image (extracted from the existing code)
async function generateImage(
  workflow: any
): Promise<{ seed: number; savedPaths: string[] }> {
  const clientId = uuidv4();
  const ws = new WebSocket(`ws://${serverAddress}/ws?clientId=${clientId}`);

  const { prompt_id } = await queuePrompt(workflow);

  const outputImages: { [key: string]: Buffer[] } = {};

  return new Promise<{ seed: number; savedPaths: string[] }>(
    (resolve, reject) => {
      const eventEmitter = new EventEmitter();
      messageHandlers.set(clientId, eventEmitter);

      let messageCount = 0;
      const timeout = setTimeout(() => {
        console.log(
          `Timeout reached for ${clientId}. Resolving generateImage.`
        );
        messageHandlers.delete(clientId);
        reject(new Error("Timeout reached while generating image"));
      }, 300000); // 5 minutes timeout

      eventEmitter.on("message", async (data: WebSocket.Data) => {
        messageCount++;
        console.log(`Message ${messageCount} received for ${clientId}`);

        if (messageCount === 3) {
          console.log(
            `Processing image after receiving 3rd message for ${clientId}`
          );
          try {
            const history = await getHistory(prompt_id);
            for (const nodeId in history[prompt_id].outputs) {
              const nodeOutput = history[prompt_id].outputs[nodeId];
              if ("images" in nodeOutput) {
                const imagesOutput: Buffer[] = [];
                for (const image of nodeOutput.images) {
                  const imageData = await getImage(
                    image.filename,
                    image.subfolder,
                    image.type
                  );
                  imagesOutput.push(imageData);
                }
                outputImages[nodeId] = imagesOutput;
              }
            }

            const savedPaths = await saveImages(
              outputImages,
              workflow["3"]["inputs"]["seed"]
            );

            clearTimeout(timeout);
            messageHandlers.delete(clientId);
            ws.close();
            resolve({
              seed: workflow["3"]["inputs"]["seed"],
              savedPaths: savedPaths,
            });
          } catch (error) {
            console.error(`Error processing images for ${clientId}:`, error);
            clearTimeout(timeout);
            messageHandlers.delete(clientId);
            ws.close();
            reject(error);
          }
        } else if (typeof data === "string") {
          try {
            const message = JSON.parse(data);
            console.log(
              `Received message for ${clientId}: ${JSON.stringify(message)}`
            );
            if (message.type === "progress") {
              console.log(
                `Progress for ${clientId}: ${message.data.value}/${message.data.max}`
              );
            } else if (message.type === "executing") {
              console.log(
                `Executing node for ${clientId}: ${message.data.node}`
              );
            }
          } catch (error) {
            console.error(
              `Error parsing WebSocket message for ${clientId}:`,
              error
            );
          }
        }
      });

      eventEmitter.on("close", () => {
        console.log(`WebSocket connection closed for ${clientId}`);
        clearTimeout(timeout);
        messageHandlers.delete(clientId);
        reject(new Error("WebSocket connection closed unexpectedly"));
      });

      eventEmitter.on("error", (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
        clearTimeout(timeout);
        messageHandlers.delete(clientId);
        reject(error);
      });

      ws.on("message", (data) => {
        const handler = messageHandlers.get(clientId);
        if (handler) {
          handler.emit("message", data);
        }
      });

      ws.on("close", () => {
        const handler = messageHandlers.get(clientId);
        if (handler) {
          handler.emit("close");
        }
      });

      ws.on("error", (error) => {
        const handler = messageHandlers.get(clientId);
        if (handler) {
          handler.emit("error", error);
        }
      });
    }
  );
}

// Update the generate-images endpoint
app.post("/generate-images", async (req, res) => {
  try {
    const {
      positivePrompt,
      negativePrompt,
      steps = 30,
      resolution = [1024, 1024],
      inputImagePath,
      seed,
    } = req.body;

    // Use the pre-loaded workflow
    const workflow = JSON.parse(JSON.stringify(workflowJson));

    // Customize workflow based on inputs
    workflow["6"]["inputs"]["text"] = positivePrompt;
    workflow["7"]["inputs"]["text"] = negativePrompt;
    workflow["3"]["inputs"]["steps"] = steps;
    workflow["5"]["inputs"]["width"] = resolution[0];
    workflow["5"]["inputs"]["height"] = resolution[1];
    workflow["3"]["inputs"]["seed"] = seed || getRandomSeed();
    workflow["13"]["inputs"]["image"] = inputImagePath;

    console.log(`Using seed: ${workflow["3"]["inputs"]["seed"]}`);
    console.log("Final workflow JSON:");
    console.log(JSON.stringify(workflow, null, 2));

    const result = await new Promise((resolve, reject) => {
      imageGenerationQueue.enqueue({ resolve, reject, workflow });
      processQueue(); // Start processing the queue if it's not already processing
    });

    res.json(result);
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating images" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
