# ComfyUI Image Generation API

This project is a TypeScript-based Express server that interfaces with ComfyUI to generate images based on text prompts. It provides endpoints for testing image generation and custom image generation based on user inputs.

## Prerequisites

- Node.js (v14 or later)
- npm (Node Package Manager)
- ComfyUI server running locally or on a remote machine

## Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd ts-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory and add the following:
   ```
   PORT=3000
   COMFYUI_SERVER_ADDRESS=localhost:8188
   ```
   Adjust the `COMFYUI_SERVER_ADDRESS` if your ComfyUI server is running on a different address.

4. Ensure that the `workflow_api.json` file is present in the root directory of the project.

## Running the Server

To start the server in development mode with hot-reloading:
```
npm run dev
```

To build and run the server in production mode:
```
npm run build
npm start
```

## Available Endpoints

### 1. Test Image Generation

- **URL**: `/test-generate-images`
- **Method**: POST
- **Description**: Generates an image using predefined prompts and settings.

Example usage with curl:
```
curl -X POST http://localhost:3000/test-generate-images
```

### 2. Custom Image Generation

- **URL**: `/generate-images`
- **