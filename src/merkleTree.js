import crypto from 'crypto'; // Import the crypto module for hashing
import { db } from './db.js'; // Import the database connection module

class Node {
  /**
   * Represents a node in the Merkle tree.
   * @param {Node|null} left - Left child node
   * @param {Node|null} right - Right child node
   * @param {string} value - Hash value of the node
   * @param {boolean} isCopied - Flag to indicate if the node is copied
   */
  constructor(left, right, value, isCopied) {
    this.left = left; // Left child node
    this.right = right; // Right child node
    this.value = value; // Hash value of the node
    this.isCopied = isCopied; // Indicates if the node was copied
  }

  /**
   * Creates a hash of the given value using SHA-256.
   * @param {string} data - Value to hash
   * @returns {string} - SHA-256 hash of the value
   */
  static hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Creates a copy of the current node.
   * @returns {Node} - A new Node object with the same properties
   */
  copy() {
    return new Node(this.left, this.right, this.value, true);
  }
}

class MerkleTree {
  /**
   * Constructs a Merkle Tree from a list of values.
   * @param {string[]} values - List of values to build the Merkle Tree from
   * @throws {Error} - If no values are provided
   */
  constructor(values) {
    if (!values || values.length === 0) {
      throw new Error("Cannot build Merkle Tree with no values.");
    }
    this.root = this.buildTree(values); // Build the Merkle Tree and set the root
  }

  /**
   * Saves all nodes of the Merkle Tree to the database.
   * @param {string} blockHash - Hash of the block associated with the Merkle Tree
   * @param {Node} [node=this.root] - Current node being processed
   * @param {number} [level=0] - Current level in the tree
   * @param {number} [index=0] - Index of the current node
   * @returns {Promise<void>}
   */
  async saveNodesToDatabase(blockHash, node = this.root, level = 0, index = 0) {
    if (node !== null) {
      const query = "INSERT INTO merkle_nodes (block_hash, node_level, node_index, node_value) VALUES (?, ?, ?, ?)";
      const values = [blockHash, level, index, node.value];
      
      try {
        await db.query(query, values);
        //console.log(`Saved node at level ${level}, index ${index}: ${node.value}`);
      } catch (err) {
        console.error("Database query error:", err);
        throw err;
      }
  
      if (node.left !== null) {
        await this.saveNodesToDatabase(blockHash, node.left, level + 1, index * 2);
        await this.saveNodesToDatabase(blockHash, node.right, level + 1, index * 2 + 1);
      }
    }
  }

  /**
   * Builds the Merkle Tree from a list of leaf nodes.
   * @param {string[]} values - List of values to be used as leaf nodes
   * @returns {Node} - Root node of the constructed Merkle Tree
   */
  buildTree(values) {
    // Create leaf nodes with transaction hashes directly
    let leaves = values.map((e) => new Node(null, null, e, false));

    // If there is an odd number of leaves, duplicate the last leaf
    if (leaves.length % 2 === 1) {
      leaves.push(leaves[leaves.length - 1].copy());
    }

    return this.buildTreeRec(leaves); // Build the tree recursively
  }

  /**
   * Recursively builds the Merkle Tree from a list of nodes.
   * @param {Node[]} nodes - List of nodes at the current level
   * @param {number} [depth=0] - Current recursion depth
   * @returns {Node} - Root node of the constructed tree
   * @throws {Error} - If maximum recursion depth is exceeded or no nodes are provided
   */
  buildTreeRec(nodes, depth = 0) {
    const maxDepth = 10; // Maximum allowed recursion depth
    if (depth > maxDepth) {
      throw new Error("Max recursion depth exceeded");
    }

    if (nodes.length === 1) {
      return nodes[0]; // Return the root node when only one node is left
    }

    if (nodes.length === 0) {
      throw new Error("No nodes to process.");
    }

    // If there is an odd number of nodes, duplicate the last node
    if (nodes.length % 2 === 1) {
      nodes.push(nodes[nodes.length - 1].copy());
    }

    // Build the next level of nodes
    const newLevel = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = nodes[i + 1];
      const value = Node.hash(left.value + right.value); // Combine and hash the left and right nodes
      newLevel.push(new Node(left, right, value, false)); // Create a new parent node
    }

    return this.buildTreeRec(newLevel, depth + 1); // Recursively build the tree
  }

  /**
   * Prints the Merkle Tree to the console.
   */
  printTree() {
    this.printTreeRec(this.root); // Start printing from the root
  }

  /**
   * Recursively prints the Merkle Tree.
   * @param {Node} node - Current node being printed
   * @param {number} [level=0] - Current level in the tree
   */
  printTreeRec(node, level = 0) {
    if (node !== null) {
      if (node.left !== null) {
        this.printTreeRec(node.left, level + 1); // Print left subtree
        //console.log(" ".repeat(level * 2) + node.value); // Print current node value
        this.printTreeRec(node.right, level + 1); // Print right subtree
      } else {
        //console.log(" ".repeat(level * 2) + node.value); // Print leaf node value
      }
    }
  }

  /**
   * Gets the hash of the root node of the Merkle Tree.
   * @returns {string} - Hash value of the root node
   */
  getRootHash() {
    return this.root.value; // Return the root node's hash value
  }

  /**
   * Verify a proof path for a given leaf hash.
   * @param {string} leaf - The hash of the leaf node (transaction hash).
   * @param {string[]} proof - The proof path (array of sibling hashes).
   * @param {string} root - The root hash of the Merkle tree.
   * @returns {boolean} - True if the proof is valid, false otherwise.
   */
  static verifyProof(leaf, proof, root) {
    let hash = leaf;
  
    for (const { siblingHash, direction } of proof) {
      if (direction === 'left') {
        // Sibling is on the right
        hash = Node.hash(hash + siblingHash);
      } else if (direction === 'right') {
        // Sibling is on the left
        hash = Node.hash(siblingHash + hash);
      } else {
        // Invalid direction
        return false;
      }
    }
  
    // Check if the final computed hash matches the Merkle root
    return hash === root;
  }

  

  

  /**
   * Gets the proof for a specific leaf value.
   * @param {string} leafValue - The hash of the leaf node to find
   * @returns {Array<string>} - The proof path for the leaf node
   */
  getProof(leafValue) {
    const proof = [];
    const found = this.getProofRec(this.root, leafValue, proof);
    if (!found) {
      throw new Error('Leaf not found in the Merkle Tree');
    }
    return proof;
  }
  
  getProofRec(node, targetHash, proof) {
    if (!node) {
      return false;
    }
  
    if (!node.left && !node.right) {
      // Leaf node
      return node.value === targetHash;
    }
  
    if (this.getProofRec(node.left, targetHash, proof)) {
      // Target is in left subtree; sibling is on the right
      proof.push({ siblingHash: node.right.value, direction: 'left' });
      return true;
    }
  
    if (this.getProofRec(node.right, targetHash, proof)) {
      // Target is in right subtree; sibling is on the left
      proof.push({ siblingHash: node.left.value, direction: 'right' });
      return true;
    }
  
    return false;
  }

  containsHash(node, targetHash) {
    if (!node) return false;
    if (node.value === targetHash) return true;
    return this.containsHash(node.left, targetHash) || this.containsHash(node.right, targetHash);
  }
  

  /**
   * Finds the index of a leaf node with the given value.
   * @param {Node} node - The current node being processed.
   * @param {string} leafValue - The value of the leaf node to find.
   * @returns {number} - The index of the leaf node or -1 if not found.
   */
  findLeafIndex(node, leafValue) {
    if (!node) return -1;
    if (!node.left && !node.right) return node.value === leafValue ? 0 : -1;
  
    const leftIndex = this.findLeafIndex(node.left, leafValue);
    if (leftIndex !== -1) return leftIndex * 2;
  
    const rightIndex = this.findLeafIndex(node.right, leafValue);
    const foundIndex = rightIndex !== -1 ? rightIndex * 2 + 1 : -1;
    
    return foundIndex;
  }

  /**
   * Gets all leaf nodes of the tree.
   * @returns {Node[]} - An array of leaf nodes.
   */
  getLeaves() {
    const leaves = [];
    this.collectLeaves(this.root, leaves);
    return leaves;
  }

  /**
   * Recursively collects leaf nodes.
   * @param {Node} node - The current node being processed.
   * @param {Node[]} leaves - The array to collect leaf nodes into.
   */
  collectLeaves(node, leaves) {
    if (!node) return;
    if (!node.left && !node.right) {
      leaves.push(node);
    } else {
      this.collectLeaves(node.left, leaves);
      this.collectLeaves(node.right, leaves);
    }
  }
}

// New class added to the file
class MerkleProofPath {
  static async getProofPath(transactionHash) {
    const query = "SELECT proof_path FROM merkle_proof_paths WHERE transaction_hash = ?";
    console.log("Retrieving proof path for transaction:", transactionHash);

    try {
      const [rows] = await db.query(query, [transactionHash]);

      if (rows.length === 0) {
        // No proof path found for the given transaction hash
        console.log("No proof path found for transaction:", transactionHash);
        return null;
      }

      // Assuming only one result is returned per transaction_hash
      const proofPath = JSON.parse(rows[0].proof_path);
      console.log("Verified proof path:", proofPath);
      return proofPath;
    } catch (err) {
      console.error("Error retrieving proof path:", err);
      throw err;
    }
  }
}

export { Node, MerkleTree, MerkleProofPath };

