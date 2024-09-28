import WebSocket, { WebSocketServer } from 'ws';
import { Transaction } from './transaction.js';
import { Block } from './block.js';
import { blockchainInstance } from './blockchain.js';

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
          await handleReceivedTransaction(message.data);
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





let lastProcessedBlockHash = null;

async function handleReceivedBlock(receivedBlockData) {
    const newBlock = Block.fromJSON(receivedBlockData);
  
    if (lastProcessedBlockHash === newBlock.hash) {
      
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
      
      
      lastProcessedBlockHash = newBlock.hash;
      return;
    }
  
    const added = await blockchainInstance.addBlock(newBlock);
    if (added) {
      
  
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
};

