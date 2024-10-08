import WebSocket, { WebSocketServer } from 'ws';
import { Transaction } from './transaction.js';
import { Block } from './block.js';
import { blockchainInstance, createToken, transferToken } from './blockchain.js';
import { db } from './db.js';

const P2P_PORT = process.env.P2P_PORT || 6001;
const peers = process.env.PEERS ? process.env.PEERS.split(',') : [];
const sockets = [];

let connectedPeers = [];

function initConnection(ws) {
  sockets.push(ws);
  connectedPeers.push(ws);
  blockchainInstance.setConnectedPeers(connectedPeers);
  initMessageHandler(ws);
  initErrorHandler(ws);
  requestFullChain(ws);
}

function requestFullChain(ws) {
  ws.send(JSON.stringify({
    type: 'REQUEST_FULL_CHAIN',
  }));
}

function initMessageHandler(ws) {
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'REQUEST_FULL_CHAIN':
          await handleFullChainRequest(ws);
            break;
        case 'FULL_CHAIN':
          await handleReceivedFullChain(message.data);
            break;       
        case 'NEW_BLOCK':
          await handleReceivedBlock(message.data);
            break;
        case 'NEW_TRANSACTION':
          await handleReceivedTransaction(message.data, ws);
            break;
        /*case 'CREATE_TOKEN':
          await handleCreateToken(message.data, ws);
            break;
        case 'TRANSFER_TOKEN':
          await handleTransferToken(message.data, ws);
            break;*/
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });
}

function initErrorHandler(ws) {
  const closeConnection = () => {
    console.log('Connection closed');
    sockets.splice(sockets.indexOf(ws), 1);
  };
  ws.on('close', closeConnection);
  ws.on('error', closeConnection);
}

function broadcastChain() {
  const chainData = blockchainInstance.chain.map(block => block.toJSON());
  sockets.forEach((socket) => socket.send(JSON.stringify({
    type: 'FULL_CHAIN',
    data: chainData,
  })));
}

function sendChain(socket) {
  const chainData = blockchainInstance.chain.map(block => block.toJSON());
  socket.send(JSON.stringify({
    type: 'FULL_CHAIN',
    data: chainData,
  }));
}

function broadcastBlock(block, excludeSocket = null) {
    const blockData = block.toJSON();
    sockets.forEach((socket) => {
      if (socket !== excludeSocket) { // Exclude the sender
        socket.send(JSON.stringify({
          type: 'NEW_BLOCK',
          data: blockData,
        }));
      }
    });
}

function broadcastTransaction(transaction, excludeSocket = null) {
    const txData = transaction.toJSON();
    sockets.forEach((socket) => {
      if (socket !== excludeSocket) { // Exclude the sender
        socket.send(JSON.stringify({
          type: 'NEW_TRANSACTION',
          data: txData,
        }));
      }
    });
}

function broadcastCreateToken(token, excludeSocket = null) {
    sockets.forEach((socket) => {
      if (socket !== excludeSocket) { // Exclude the sender
        socket.send(JSON.stringify({
          type: 'CREATE_TOKEN',
          data: token,
        }));
      }
    });
}

function broadcastTransferToken(transferData, excludeSocket = null) {
    sockets.forEach((socket) => {
      if (socket !== excludeSocket) { // Exclude the sender
        socket.send(JSON.stringify({
          type: 'TRANSFER_TOKEN',
          data: transferData,
        }));
      }
    });
}

let lastProcessedBlockHash = null;

async function handleReceivedBlock(receivedBlockData) {
    const newBlock = Block.fromJSON(receivedBlockData);
  
    if (lastProcessedBlockHash === newBlock.hash) {
      // Already processed this block
      
      return;
    }
  
    const blockExists = await Block.load(newBlock.hash);
    if (blockExists) {
      // Prevent adding the same block to the in-memory chain multiple times
      if (blockchainInstance.chain.some(block => block.hash === newBlock.hash)) {
        
        lastProcessedBlockHash = newBlock.hash;
        return;
      }
  
      // If not in the in-memory chain but exists in the database, load it
      const loadedBlock = await Block.load(newBlock.hash);
      blockchainInstance.chain.push(loadedBlock);
      
      console.log(`Loaded existing block ${loadedBlock.index} from database.`);
      lastProcessedBlockHash = newBlock.hash;
      return;
    }
  
    // **Reorder transactions: Token creation transactions first**
    newBlock.transactions.sort((a, b) => {
      const isATokenCreation = a.tokenId && a.tokenName && a.tokenSymbol && a.tokenTotalSupply;
      const isBTokenCreation = b.tokenId && b.tokenName && b.tokenSymbol && b.tokenTotalSupply;
      
      if (isATokenCreation && !isBTokenCreation) return -1;
      if (!isATokenCreation && isBTokenCreation) return 1;
      return 0; // Maintain original order if both are token creation or both are not
    });

    console.log(`Processing Block ${newBlock.index} with ${newBlock.transactions.length} transactions.`);
  
    const added = await blockchainInstance.addBlock(newBlock);
    if (added) {
      console.log(`Block ${newBlock.index} added successfully.`);
      
      // Clear pending transactions that were included in the new block
      blockchainInstance.pendingTransactions = blockchainInstance.pendingTransactions.filter(tx => 
          !newBlock.transactions.some(newTx => newTx.hash === tx.hash)
      );

      await blockchainInstance.clearMinedTransactions(newBlock.transactions);

      // Remove mined transactions from the transaction pool
      newBlock.transactions.forEach(tx => {
        blockchainInstance.transactionPool.delete(tx.hash);
      });

      broadcastBlock(newBlock);
      lastProcessedBlockHash = newBlock.hash;
    } else {
      console.log(`Failed to add Block ${newBlock.index}. Requesting full chain.`);
      broadcastChain(); // Request the full chain from peers
    }
}


const processedTransactions = new Set();

async function handleReceivedTransaction(receivedTxData, senderSocket) {
    const tx = Transaction.fromJSON(receivedTxData);
  
    // Check if the transaction has already been processed
    if (processedTransactions.has(tx.hash)) {
      return;
    }
  
    // Verify if token_id exists if it's a token transaction
    if (tx.tokenId !== null) {
      const [tokenRows] = await db.query("SELECT * FROM tokens WHERE token_id = ?", [tx.tokenId]);
      if (tokenRows.length === 0) {
        
        return;
      }
    }
  
    try {
      // Check if the transaction already exists in the pending_transactions table
      const existingTransaction = await Transaction.loadPendingTransactionByHash(tx.hash);
      
      if (existingTransaction) {
        return;
      }
  
      // Add the transaction to pending transactions
      await blockchainInstance.addPendingTransaction(tx);
      
  
      // Mark the transaction as processed
      processedTransactions.add(tx.hash);
  
      // Broadcast the transaction to other peers, excluding the sender
      broadcastTransaction(tx, senderSocket);
    } catch (error) {
      console.error('Failed to add received transaction:', error.message);
    }
}
  

async function handleCreateToken(tokenData, senderSocket) {
  try {
    const { name, symbol, total_supply, creator_address, timestamp, token_id } = tokenData;

    // Check if token already exists
    const [rows] = await db.query("SELECT * FROM tokens WHERE token_id = ?", [token_id]);
    if (rows.length > 0) {
      return;
    }

    // Insert the token into the database
    const query = "INSERT INTO tokens (token_id, name, symbol, total_supply, creator_address, timestamp) VALUES (?, ?, ?, ?, ?, ?)";
    const values = [token_id, name, symbol, total_supply, creator_address, timestamp];
    await db.query(query, values);

    // Update token_balances
    const balanceQuery = 
      `INSERT INTO token_balances (address, token_id, balance)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE balance = balance + ?`;
    await db.query(balanceQuery, [creator_address, token_id, total_supply, total_supply]);

    broadcastCreateToken(tokenData, senderSocket);
  } catch (error) {
    console.error('Failed to handle CREATE_TOKEN:', error.message);
  }
}

async function handleTransferToken(transferData, senderSocket) {
    try {
      const { fromAddress, toAddress, amount, tokenId, timestamp, hash } = transferData;
  
      // Check if transaction already exists
      const [rows] = await db.query("SELECT * FROM transactions WHERE hash = ?", [hash]);
      if (rows.length > 0) {
        return;
      }
  
      // **Ensure the receiver's address exists in address_balances**
      const insertToAddressQuery = 
        `INSERT INTO address_balances (address, balance)
         VALUES (?, 0.00000000)
         ON DUPLICATE KEY UPDATE balance = balance`;
      await db.query(insertToAddressQuery, [toAddress]);
  
      // Create and save the transaction
      const tx = new Transaction(fromAddress, toAddress, amount, timestamp, null, null, null, '', null, tokenId);
      tx.hash = hash;
      await tx.save();
  
      // **Do not update token balances here**
      // The balances will be updated during block mining
  
      broadcastTransferToken(transferData, senderSocket);
    } catch (error) {
      console.error('Failed to handle TRANSFER_TOKEN:', error.message);
    }
}

async function handleFullChainRequest(ws) {
  const chainData = blockchainInstance.chain.map(block => block.toJSON());
  ws.send(JSON.stringify({
    type: 'FULL_CHAIN',
    data: chainData,
  }));
}

async function handleReceivedFullChain(receivedChain) {
  try {
    if (!receivedChain || receivedChain.length === 0) {
      return;
    }

    const isValid = await blockchainInstance.constructor.isValidChain(receivedChain);
    if (!isValid) {
      console.log("Received chain is invalid.");
      return;
    }

    const localCumulativeDifficulty = blockchainInstance.calculateCumulativeDifficulty(
      blockchainInstance.chain.map(block => block.toJSON())
    );
    const receivedCumulativeDifficulty = blockchainInstance.calculateCumulativeDifficulty(receivedChain);

    if (receivedCumulativeDifficulty > localCumulativeDifficulty) {
      await blockchainInstance.replaceChain(receivedChain);
      broadcastChain(); // Notify other peers about the updated chain
      
    } else {
      // Optionally, request the full chain again or take other actions
    }
  } catch (err) {
    console.error("Error handling received full chain:", err);
  }
}

function connectToPeers(newPeers) {
    newPeers.forEach((peer) => {
      const ws = new WebSocket(peer);
      ws.on('open', () => {
        console.log(`Connected to peer: ${peer}`);
        initConnection(ws);
      });
      ws.on('error', (err) => {
        console.error(`Connection failed to peer ${peer}:`, err.message);
      });
    });
}

// Heartbeat mechanism to keep connections alive
function heartbeat() {
    sockets.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
  
      ws.isAlive = false;
      ws.ping(() => {
        ws.isAlive = true;
      });
    });
  }

function initP2PServer() {

  const server = new WebSocketServer({ port: P2P_PORT });

  server.on('connection', (ws) => {
    console.log('New peer connected');
    initConnection(ws);
  });

  // Initialize connections to existing peers
  connectToPeers(peers);

  // Heartbeat mechanism to keep connections alive
  const interval = setInterval(heartbeat, 30000); // Every 30 seconds

  server.on('close', () => {
    clearInterval(interval);
  });
}

export {
  initP2PServer,  
  broadcastBlock,
  broadcastChain,
  broadcastTransaction,
  broadcastCreateToken,
  broadcastTransferToken,
};
