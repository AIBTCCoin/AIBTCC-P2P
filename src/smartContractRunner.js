import { db } from './db.js'; // Ensure you have a database connection
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SmartContractRunner {
  constructor() {
      // Path to the wasmer executable
      this.wasmerPath = 'wasmer'; // Ensure 'wasmer' is in your PATH
  }

  /**
   * Retrieves available methods from the smart contract by invoking 'list_methods'.
   * @param {Buffer} wasmCode - The WASM binary of the smart contract.
   * @returns {Promise<Array<string>>} - Resolves with the list of available methods.
   */
  async getAvailableMethods(wasmCode) {
    return new Promise((resolve, reject) => {
      // Save the WASM code to a temporary file
      const tempWasmPath = path.join(__dirname, `temp_contract_${Date.now()}.wasm`);
      fs.writeFileSync(tempWasmPath, wasmCode);

      // Spawn the wasmer process
      const child = spawn(this.wasmerPath, ['run', tempWasmPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      child.on('close', async (code) => {
        // Clean up the temporary WASM file
        try {
          fs.unlinkSync(tempWasmPath);
        } catch (err) {
          console.error(`Error deleting temp WASM file at ${tempWasmPath}:`, err);
        }

        if (code !== 0) {
          reject(new Error(`WASM process exited with code ${code}: ${stderrData}`));
          return;
        }

        try {
          

          // Parse the response
          const response = JSON.parse(stdoutData.trim());

          if (response && Array.isArray(response.result)) {
            resolve(response.result);
          } else {
            throw new Error("Invalid response format from smart contract.");
          }
        } catch (err) {
          reject(new Error(`Failed to parse smart contract response: ${err.message}`));
        }
      });

      // Construct the input object
      const inputObj = { method: 'list_methods', params: {} };

      // Send the 'list_methods' command as JSON
      const command = JSON.stringify(inputObj) + '\n';
      
      child.stdin.write(command);
      child.stdin.end();
    });
  }

  /**
   * Executes a smart contract method by sending a JSON command via stdin
   * and reading the JSON response from stdout.
   * @param {Buffer} wasmCode - The WASM binary of the smart contract.
   * @param {string} method - The method name to invoke.
   * @param {object} params - The parameters to pass to the method.
   * @param {string} transactionHash - The hash of the transaction invoking this method.
   * @returns {Promise<object>} - Resolves with { result, updatedState }.
   */
  async executeMethod(wasmCode, method, params, transactionHash, state) {
    return new Promise((resolve, reject) => {
      // Save the WASM code to a temporary file
      const tempWasmPath = path.join(__dirname, `temp_contract_${Date.now()}.wasm`);
      fs.writeFileSync(tempWasmPath, wasmCode);

      // Spawn the wasmer process
      const child = spawn(this.wasmerPath, ['run', tempWasmPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      child.on('close', async (code) => {
        // Clean up the temporary WASM file
        try {
          fs.unlinkSync(tempWasmPath);
        } catch (err) {
          console.error(`Error deleting temp WASM file at ${tempWasmPath}:`, err);
        }


        if (code !== 0) {
          reject(new Error(`WASM process exited with code ${code}: ${stderrData}`));
          return;
        }

        try {
          // Parse the response
          const response = JSON.parse(stdoutData.trim());

          if (!('result' in response) || !('state' in response)) {
            throw new Error("Smart contract did not return a complete response.");
          }

          // Handle events from stderr only if they contain valid JSON
          if (stderrData && stderrData.trim()) {
            // Each event is a separate JSON object per line
            const eventLines = stderrData.trim().split('\n');
            for (const eventLine of eventLines) {
              try {
                const event = JSON.parse(eventLine);
                await this.emitEvent(event.event, event.data, transactionHash);
              } catch (err) {
                // If parsing fails, log as a warning but don't treat it as an error
                console.warn(`Non-JSON message in STDERR: "${eventLine}"`);
              }
            }
          }

          resolve({ result: response.result, updatedState: response.state });
        } catch (err) {
          reject(new Error(`Failed to parse smart contract response: ${err.message}`));
        }
      });

      // Construct the input object
      const inputObj = { method, params: params || {} };

      // Only include state if it's not an empty object
      if (state && Object.keys(state).length > 0) {
        inputObj.state = state;
      }

      // Send the method invocation as JSON
      const command = JSON.stringify(inputObj) + '\n';
      child.stdin.write(command);
      child.stdin.end();
    });
  }


  /**
   * Handles emitted events from smart contracts.
   * @param {string} name - The name of the event.
   * @param {object} data - The data associated with the event.
   */
  /**
   * Handles emitted events from smart contracts.
   * @param {string} name - The name of the event.
   * @param {object} data - The data associated with the event.
   * @param {string} transactionHash - The hash of the transaction emitting this event.
   */
  async emitEvent(name, data, transactionHash) {
    console.log(`Event emitted: ${name}, data: ${JSON.stringify(data)}`);
    const query = 
        "INSERT INTO contract_events (transaction_hash, event_name, event_data, timestamp) VALUES (?, ?, ?, ?)";
    const values = [transactionHash, name, JSON.stringify(data), Date.now()];

    try {
        await db.query(query, values);
        console.log(`Event ${name} saved to the database.`);
    } catch (err) {
        console.error(`Failed to save event ${name} to the database:`, err);
    }
  }

}

const smartContractRunnerInstance = new SmartContractRunner();
export default smartContractRunnerInstance;







