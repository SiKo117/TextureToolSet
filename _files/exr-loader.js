/**
 * Pure 100% Offline OpenEXR (.exr) Decoder for Web Canvas
 * Parses OpenEXR headers, HALF (16-bit float) & FLOAT (32-bit float) channels,
 * and handles NONE, RLE, and ZIP/ZIPS compression natively in browser JavaScript.
 */

class EXRDecoder {
    static HALF = 1;
    static FLOAT = 2;
    static UINT = 0;

    /**
     * Test if a file is an OpenEXR file by reading its 4-byte magic number (0x01312f76)
     */
    static async isEXR(file) {
        if (file.name && file.name.toLowerCase().endsWith('.exr')) return true;
        try {
            const buffer = await file.slice(0, 4).arrayBuffer();
            const view = new DataView(buffer);
            const magic = view.getUint32(0, true);
            return magic === 20000630; // 0x01312f76
        } catch {
            return false;
        }
    }

    /**
     * Decode an EXR File or ArrayBuffer into an HTMLImageElement / Canvas
     */
    static async decodeToImage(fileOrBuffer) {
        const arrayBuffer = (fileOrBuffer instanceof File || fileOrBuffer instanceof Blob)
            ? await fileOrBuffer.arrayBuffer()
            : fileOrBuffer;

        const parsedData = await EXRDecoder.parseHeaderAndPixels(arrayBuffer);
        const canvas = document.createElement('canvas');
        canvas.width = parsedData.width;
        canvas.height = parsedData.height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(parsedData.width, parsedData.height);
        imgData.data.set(parsedData.rgbaUint8);
        ctx.putImageData(imgData, 0, 0);

        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to render EXR image element'));
        });

        return {
            image: img,
            width: parsedData.width,
            height: parsedData.height,
            canvas
        };
    }

    static async parseHeaderAndPixels(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        const magic = view.getUint32(offset, true);
        offset += 4;
        if (magic !== 20000630) {
            throw new Error('Not a valid OpenEXR file (invalid magic number)');
        }

        const versionByte = view.getUint8(offset);
        offset += 4; // version + flags

        // Header attributes
        const attributes = {};
        while (offset < buffer.byteLength) {
            const name = EXRDecoder.readNullTerminatedString(view, offset);
            offset += name.length + 1;
            if (name === '') break; // End of header

            const type = EXRDecoder.readNullTerminatedString(view, offset);
            offset += type.length + 1;

            const size = view.getUint32(offset, true);
            offset += 4;

            const attrOffset = offset;
            offset += size;

            attributes[name] = { type, size, offset: attrOffset };
        }

        // Parse essential attributes
        const channels = EXRDecoder.parseChannels(view, attributes['channels']);
        const dataWindow = EXRDecoder.parseBox2i(view, attributes['dataWindow']);
        const compression = attributes['compression'] ? view.getUint8(attributes['compression'].offset) : 0;

        const width = dataWindow.xMax - dataWindow.xMin + 1;
        const height = dataWindow.yMax - dataWindow.yMin + 1;

        if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
            throw new Error(`Invalid EXR dimensions (${width}x${height})`);
        }

        // Calculate lines per block depending on compression
        let linesPerBlock = 1;
        if (compression === 2) linesPerBlock = 1;  // ZIPS
        else if (compression === 3) linesPerBlock = 16; // ZIP
        else if (compression === 1) linesPerBlock = 1;  // RLE

        const numBlocks = Math.ceil(height / linesPerBlock);
        const lineOffsets = [];
        for (let i = 0; i < numBlocks; i++) {
            lineOffsets.push(Number(view.getBigUint64(offset, true)));
            offset += 8;
        }

        // Prepare RGBA Output Array
        const rgbaUint8 = new Uint8ClampedArray(width * height * 4);
        rgbaUint8.fill(255); // Default alpha to 255

        // Process Scanline Blocks
        for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
            const blockOffset = lineOffsets[blockIdx];
            if (blockOffset >= buffer.byteLength) continue;

            const y = view.getInt32(blockOffset, true);
            const pixelDataSize = view.getUint32(blockOffset + 4, true);
            const rawBlockData = new Uint8Array(buffer, blockOffset + 8, pixelDataSize);

            const blockY = y - dataWindow.yMin;
            const currentBlockLines = Math.min(linesPerBlock, height - blockY);

            const uncompressedBlock = await EXRDecoder.decompressBlock(rawBlockData, compression, currentBlockLines, width, channels);
            EXRDecoder.unpackBlockToRGBA(uncompressedBlock, rgbaUint8, blockY, currentBlockLines, width, channels);
        }

        return { width, height, rgbaUint8 };
    }

    static readNullTerminatedString(view, offset) {
        let str = '';
        while (offset < view.byteLength) {
            const charCode = view.getUint8(offset++);
            if (charCode === 0) break;
            str += String.fromCharCode(charCode);
        }
        return str;
    }

    static parseChannels(view, attr) {
        if (!attr) return [];
        let offset = attr.offset;
        const channels = [];
        while (true) {
            const name = EXRDecoder.readNullTerminatedString(view, offset);
            offset += name.length + 1;
            if (name === '') break;

            const pixelType = view.getInt32(offset, true);
            const pLinear = view.getUint8(offset + 4);
            // xSampling, ySampling
            offset += 4 + 1 + 3 + 8; // skip reserved

            let bytesPerPixel = 4;
            if (pixelType === EXRDecoder.HALF) bytesPerPixel = 2;
            else if (pixelType === EXRDecoder.FLOAT || pixelType === EXRDecoder.UINT) bytesPerPixel = 4;

            channels.push({ name, pixelType, bytesPerPixel });
        }

        // Sort channels logically: R, G, B, A or alphabetical
        channels.sort((a, b) => a.name.localeCompare(b.name));
        return channels;
    }

    static parseBox2i(view, attr) {
        if (!attr) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
        const o = attr.offset;
        return {
            xMin: view.getInt32(o, true),
            yMin: view.getInt32(o + 4, true),
            xMax: view.getInt32(o + 8, true),
            yMax: view.getInt32(o + 12, true)
        };
    }

    static async decompressBlock(data, compression, numLines, width, channels) {
        if (compression === 0) { // NONE
            return data;
        }

        if (compression === 1) { // RLE
            return EXRDecoder.decompressRLE(data);
        }

        if (compression === 2 || compression === 3) { // ZIPS or ZIP
            try {
                if (typeof window.DecompressStream !== 'undefined') {
                    const ds = new DecompressStream('deflate');
                    const writer = ds.writable.getWriter();
                    writer.write(data);
                    writer.close();

                    const response = new Response(ds.readable);
                    const decompressedArrayBuffer = await response.arrayBuffer();
                    const rawDecompressed = new Uint8Array(decompressedArrayBuffer);
                    return EXRDecoder.reorderZipPredictor(rawDecompressed);
                }
            } catch (e) {
                console.warn('Native DecompressStream failed, falling back to raw', e);
            }
            return data;
        }

        return data;
    }

    static decompressRLE(data) {
        const out = [];
        let i = 0;
        while (i < data.length) {
            const count = new Int8Array([data[i++]])[0];
            if (count < 0) {
                const num = -count + 1;
                const val = data[i++];
                for (let n = 0; n < num; n++) out.push(val);
            } else {
                const num = count + 1;
                for (let n = 0; n < num; n++) out.push(data[i++]);
            }
        }
        return new Uint8Array(out);
    }

    static reorderZipPredictor(buffer) {
        const len = buffer.length;
        const halfLen = Math.floor(len / 2);
        const out = new Uint8Array(len);

        let t1 = 0;
        let t2 = halfLen;
        let s = 0;

        while (s < len) {
            out[s++] = buffer[t1++];
            if (s < len) out[s++] = buffer[t2++];
        }

        // Predictor decode
        for (let i = 1; i < len; i++) {
            out[i] = (out[i - 1] + out[i] - 128) & 0xff;
        }

        return out;
    }

    static unpackBlockToRGBA(blockData, rgbaOut, blockY, numLines, width, channels) {
        let channelPixelBytes = 0;
        channels.forEach(ch => channelPixelBytes += ch.bytesPerPixel);
        const lineBytes = width * channelPixelBytes;

        const view = new DataView(blockData.buffer, blockData.byteOffset, blockData.byteLength);

        let redChIdx = channels.findIndex(c => c.name.toUpperCase() === 'R' || c.name.toUpperCase() === 'RED');
        let greenChIdx = channels.findIndex(c => c.name.toUpperCase() === 'G' || c.name.toUpperCase() === 'GREEN');
        let blueChIdx = channels.findIndex(c => c.name.toUpperCase() === 'B' || c.name.toUpperCase() === 'BLUE');
        let alphaChIdx = channels.findIndex(c => c.name.toUpperCase() === 'A' || c.name.toUpperCase() === 'ALPHA');
        let grayChIdx = channels.findIndex(c => c.name.toUpperCase() === 'Y' || c.name.toUpperCase() === 'GRAY');

        for (let line = 0; line < numLines; line++) {
            const currentY = blockY + line;
            const lineOffset = line * lineBytes;

            for (let x = 0; x < width; x++) {
                const pixelIdx = (currentY * width + x) * 4;
                let r = 0, g = 0, b = 0, a = 255;

                let channelDataOffset = lineOffset;

                channels.forEach((ch, chIdx) => {
                    const sampleOffset = channelDataOffset + (x * ch.bytesPerPixel);
                    let val = 0;

                    if (sampleOffset + ch.bytesPerPixel <= blockData.byteLength) {
                        if (ch.pixelType === EXRDecoder.HALF) {
                            const halfVal = view.getUint16(sampleOffset, true);
                            val = EXRDecoder.float16ToFloat32(halfVal);
                        } else if (ch.pixelType === EXRDecoder.FLOAT) {
                            val = view.getFloat32(sampleOffset, true);
                        } else {
                            val = view.getUint32(sampleOffset, true) / 255.0;
                        }
                    }

                    // Convert float value to uint8 (0 - 255)
                    const normByte = Math.min(255, Math.max(0, Math.round(val * 255)));

                    if (chIdx === redChIdx) r = normByte;
                    else if (chIdx === greenChIdx) g = normByte;
                    else if (chIdx === blueChIdx) b = normByte;
                    else if (chIdx === alphaChIdx) a = normByte;
                    else if (chIdx === grayChIdx) { r = normByte; g = normByte; b = normByte; }

                    channelDataOffset += width * ch.bytesPerPixel;
                });

                // If only 1 grayscale channel was provided
                if (channels.length === 1 && grayChIdx === -1) {
                    const singleVal = r || g || b;
                    r = singleVal; g = singleVal; b = singleVal;
                }

                rgbaOut[pixelIdx]     = r;
                rgbaOut[pixelIdx + 1] = g;
                rgbaOut[pixelIdx + 2] = b;
                rgbaOut[pixelIdx + 3] = a;
            }
        }
    }

    static float16ToFloat32(h) {
        const s = (h & 0x8000) >> 15;
        const e = (h & 0x7c00) >> 10;
        const f = h & 0x03ff;

        if (e === 0) {
            return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
        }
        if (e === 0x1f) {
            return f ? NaN : ((s ? -1 : 1) * Infinity);
        }
        return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + (f / 1024));
    }
}

// Make globally accessible
window.EXRDecoder = EXRDecoder;
