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

function requestPendingTransactionsFromPeers() {
    sockets.forEach((socket) => {
      socket.send(JSON.stringify({
        type: 'REQUEST_PENDING_TRANSACTIONS',
      }));
    });
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
        case 'REQUEST_PENDING_TRANSACTIONS':
            sendPendingTransactions(ws);
            break;
        case 'PENDING_TRANSACTIONS':
          await handleReceivedPendingTransactions(message.data);
            break;
        case 'MINING_LOCK':
          handleMiningLock();
            break;
        case 'MINING_UNLOCK':
          handleMiningUnlock();
            break;               
        case 'NEW_BLOCK':
          await handleReceivedBlock(message.data);
            break;
        case 'NEW_TRANSACTION':
          await handleReceivedTransaction(message.data, ws);
            break;
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

function sendPendingTransactions(socket) {
    const pendingTxs = blockchainInstance.pendingTransactions.map(tx => tx.toJSON());
    socket.send(JSON.stringify({
      type: 'PENDING_TRANSACTIONS',
      data: pendingTxs,
    }));
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

function broadcastMiningLock(excludeSocket = null) {
  sockets.forEach((socket) => {
    if (socket !== excludeSocket) {
      socket.send(JSON.stringify({
        type: 'MINING_LOCK',
      }));
    }
  });
}

function broadcastMiningUnlock(excludeSocket = null) {
  sockets.forEach((socket) => {
    if (socket !== excludeSocket) {
      socket.send(JSON.stringify({
        type: 'MINING_UNLOCK',
      }));
    }
  });
}

function handleMiningLock() {
  blockchainInstance.isMiningLocked = true;
  
}

function handleMiningUnlock() {
  blockchainInstance.isMiningLocked = false;
  
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

async function handleReceivedPendingTransactions(receivedTxDataArray) {
    for (const txData of receivedTxDataArray) {
      const tx = Transaction.fromJSON(txData);
      try {
        // Add the transaction to pending transactions if not already present
        await blockchainInstance.addPendingTransaction(tx);
      } catch (error) {
        console.error('Failed to add received pending transaction:', error.message);
      }
    }
  }


const processedTransactions = new Set();

async function handleReceivedTransaction(receivedTxData, senderSocket) {
  const tx = Transaction.fromJSON(receivedTxData);

  // Check if the transaction has already been processed
  if (processedTransactions.has(tx.hash)) {
    return;
  }

  // Check if the transaction already exists in the pending_transactions table
  const existingTransaction = await Transaction.loadPendingTransactionByHash(tx.hash);
  if (existingTransaction) {
    return;
  }

  // Handle token creation transactions
  if (tx.tokenId !== null && tx.tokenName && tx.tokenSymbol && tx.tokenTotalSupply) {
    // **Ensure creator_address exists in address_balances**
    const insertAddressQuery = `
      INSERT INTO address_balances (address, balance)
      VALUES (?, 0.00000000)
      ON DUPLICATE KEY UPDATE balance = balance
    `;
    await db.query(insertAddressQuery, [tx.toAddress]); // tx.toAddress is the creator_address

    // Check if the token already exists in the tokens table
    const [tokenRows] = await db.query("SELECT * FROM tokens WHERE token_id = ?", [tx.tokenId]);
    if (tokenRows.length === 0) {
      // Insert the token into the tokens table
      const insertTokenQuery = `
        INSERT INTO tokens (token_id, name, symbol, total_supply, creator_address, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const tokenValues = [tx.tokenId, tx.tokenName, tx.tokenSymbol, tx.tokenTotalSupply, tx.toAddress, tx.timestamp];
      await db.query(insertTokenQuery, tokenValues);
    }
  } else if (tx.tokenId !== null) {
    // For regular token transactions, ensure the token exists
    const [tokenRows] = await db.query("SELECT * FROM tokens WHERE token_id = ?", [tx.tokenId]);
    if (tokenRows.length === 0) {
      // Token does not exist; cannot process this transaction
      console.error(`Token ID ${tx.tokenId} not found. Transaction cannot be processed.`);
      return;
    }
  }

  try {
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
  requestPendingTransactionsFromPeers, 
  broadcastMiningLock,
  broadcastMiningUnlock,
};




