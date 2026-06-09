const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * FileTransfer — chunked file transfer over WebRTC DataChannel.
 * 
 * Files are split into chunks (64KB each) and sent with metadata headers.
 * The receiver reassembles chunks and writes to disk.
 * 
 * Protocol:
 *   1. Sender sends: { type: 'file-start', id, name, size, totalChunks }
 *   2. Sender sends: { type: 'file-chunk', id, index, data (base64) }
 *   3. Sender sends: { type: 'file-end', id }
 *   4. Receiver emits 'file-received' with the saved path
 * 
 * Design: Uses a dedicated DataChannel named 'filetransfer'.
 */
class FileTransfer extends EventEmitter {
  constructor(saveDir) {
    super();
    this.saveDir = saveDir || path.join(require('os').homedir(), 'OneDesk', 'Received');
    this.CHUNK_SIZE = 64 * 1024; // 64KB chunks
    this.activeTransfers = new Map(); // id -> { name, size, chunks[], received }
    this.activeSends = new Map();    // id -> { progress }
    
    // Ensure save directory exists
    if (!fs.existsSync(this.saveDir)) {
      fs.mkdirSync(this.saveDir, { recursive: true });
    }
  }

  /**
   * Prepare a file for sending. Returns an async generator of chunks.
   * @param {string} filePath - Absolute path to the file to send
   * @returns {Object} Transfer metadata + chunk generator
   */
  async prepareFile(filePath) {
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const fileSize = stats.size;
    const totalChunks = Math.ceil(fileSize / this.CHUNK_SIZE);
    const transferId = uuidv4();

    return {
      id: transferId,
      name: fileName,
      size: fileSize,
      totalChunks,
      
      /**
       * Generate chunks as base64 strings.
       * Call this in a loop and send each chunk over the DataChannel.
       */
      generateChunks: async function* () {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(this.CHUNK_SIZE);
        let offset = 0;
        let chunkIndex = 0;

        while (offset < fileSize) {
          const bytesRead = fs.readSync(fd, buffer, 0, this.CHUNK_SIZE, offset);
          const chunk = buffer.slice(0, bytesRead).toString('base64');
          
          yield {
            type: 'file-chunk',
            id: transferId,
            index: chunkIndex,
            data: chunk
          };

          offset += bytesRead;
          chunkIndex++;
        }

        fs.closeSync(fd);
      }.bind(this)
    };
  }

  /**
   * Handle incoming file transfer messages from the DataChannel.
   * @param {Object} message - The parsed message from the DataChannel
   */
  async handleMessage(message) {
    switch (message.type) {
      case 'file-start':
        this._startReceiving(message);
        break;
      case 'file-chunk':
        this._receiveChunk(message);
        break;
      case 'file-end':
        await this._finishReceiving(message);
        break;
    }
  }

  _startReceiving(msg) {
    const { id, name, size, totalChunks } = msg;
    console.log(`[FileTransfer] Receiving: ${name} (${this._formatSize(size)}, ${totalChunks} chunks)`);
    
    this.activeTransfers.set(id, {
      name,
      size,
      totalChunks,
      chunks: new Array(totalChunks),
      received: 0
    });

    this.emit('transfer-started', { id, name, size, totalChunks });
  }

  _receiveChunk(msg) {
    const { id, index, data } = msg;
    const transfer = this.activeTransfers.get(id);
    if (!transfer) return;

    transfer.chunks[index] = Buffer.from(data, 'base64');
    transfer.received++;

    const progress = Math.round((transfer.received / transfer.totalChunks) * 100);
    this.emit('transfer-progress', { id, progress, received: transfer.received, total: transfer.totalChunks });
  }

  async _finishReceiving(msg) {
    const { id } = msg;
    const transfer = this.activeTransfers.get(id);
    if (!transfer) return;

    try {
      // Reassemble file
      const fullBuffer = Buffer.concat(transfer.chunks.filter(Boolean));
      const savePath = path.join(this.saveDir, transfer.name);
      
      // Handle name collision
      const finalPath = this._getUniquePath(savePath);
      fs.writeFileSync(finalPath, fullBuffer);
      
      console.log(`[FileTransfer] Saved: ${finalPath} (${this._formatSize(fullBuffer.length)})`);
      this.emit('file-received', { id, name: transfer.name, path: finalPath, size: fullBuffer.length });
    } catch (err) {
      console.error(`[FileTransfer] Failed to save ${transfer.name}:`, err.message);
      this.emit('transfer-error', { id, error: err.message });
    } finally {
      this.activeTransfers.delete(id);
    }
  }

  _getUniquePath(filePath) {
    if (!fs.existsSync(filePath)) return filePath;
    
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    let counter = 1;
    
    while (fs.existsSync(path.join(dir, `${base} (${counter})${ext}`))) {
      counter++;
    }
    
    return path.join(dir, `${base} (${counter})${ext}`);
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

module.exports = { FileTransfer };
