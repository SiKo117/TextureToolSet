/**
 * RGBA Channel Packer & Normal Map Converter - Professional 100% Offline Logic
 * Supports Single, Bulk, Normal Map Converter, Height-to-Normal Generator, Channel Splitter & Info Modes
 * Features: OpenEXR (.exr), Smart Auto-Naming, Preview Modal, Bulk Channel Clear, Channel Splitting, Height-to-Normal Sobel Generation
 */

class RGBAChannelPacker {
    #channels = new Map();
    #resultCanvas = null;
    #allowedTypes = new Set([
        'image/png', 'image/jpeg', 'image/jpg', 
        'image/webp', 'image/tga', 'image/bmp',
        'image/x-exr', 'image/exr'
    ]);
    #maxFileSize = 100 * 1024 * 1024; // 100MB max for EXR/HDR files
    #maxDimension = 16384; // 16K Max

    // Bulk Mode State
    #bulkSets = [];
    #setCounter = 0;
    #activeMode = 'single';
    #allCollapsed = false;

    // Normal Map Converter State
    #normalQueue = [];
    #normalCounter = 0;

    // Height-to-Normal State
    #h2nQueue = [];
    #h2nCounter = 0;

    // Channel Splitter State
    #splitterQueue = [];
    #splitterCounter = 0;

    constructor() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        try {
            this.validateBrowserSupport();
            this.setupNavigation();
            this.setupSingleModeEventListeners();
            this.setupBulkModeEventListeners();
            this.setupNormalModeEventListeners();
            this.setupH2NModeEventListeners();
            this.setupSplitterModeEventListeners();
            this.setupPreviewModal();
            
            // Add initial default sets in Bulk Mode
            this.addBulkSet();
            this.addBulkSet();

            console.info('RGBA Channel Packer (All Modes & Height-to-Normal Generator) Ready.');
        } catch (err) {
            this.showToast(`Initialization failed: ${err.message}`, 'error');
            console.error('Init error:', err);
        }
    }

    validateBrowserSupport() {
        const hasCanvas = !!document.createElement('canvas').getContext;
        const hasFileAPI = !!(window.File && window.FileReader && window.FileList);
        if (!hasCanvas || !hasFileAPI) {
            throw new Error('Your browser does not support required HTML5 Canvas or File APIs.');
        }
    }

    // --- Mode Navigation Switcher ---
    setupNavigation() {
        const navBtns = document.querySelectorAll('.mode-btn');
        const singleView = document.getElementById('single-view');
        const bulkView = document.getElementById('bulk-view');
        const normalView = document.getElementById('normal-view');
        const h2nView = document.getElementById('h2n-view');
        const splitterView = document.getElementById('splitter-view');
        const infoView = document.getElementById('info-view');
        const globalConfig = document.getElementById('global-config-section');

        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.#activeMode = mode;

                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (singleView) singleView.style.display = (mode === 'single') ? 'block' : 'none';
                if (bulkView) bulkView.style.display = (mode === 'bulk') ? 'block' : 'none';
                if (normalView) normalView.style.display = (mode === 'normal') ? 'block' : 'none';
                if (h2nView) h2nView.style.display = (mode === 'h2n') ? 'block' : 'none';
                if (splitterView) splitterView.style.display = (mode === 'splitter') ? 'block' : 'none';
                if (infoView) infoView.style.display = (mode === 'info') ? 'block' : 'none';

                // Hide global packer missing-channel config when not on packer tabs
                if (globalConfig) {
                    globalConfig.style.display = (mode === 'single' || mode === 'bulk') ? 'block' : 'none';
                }
            });
        });
    }

    // --- Preview Modal ---
    setupPreviewModal() {
        const modal = document.getElementById('preview-modal');
        const closeBtn = document.getElementById('preview-modal-close');

        closeBtn?.addEventListener('click', () => {
            if (modal) modal.style.display = 'none';
        });

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    showPreviewModal(canvas, title) {
        const modal = document.getElementById('preview-modal');
        const titleEl = document.getElementById('preview-modal-title');
        const wrapper = document.getElementById('preview-modal-canvas-wrapper');

        if (!modal || !wrapper) return;

        titleEl.textContent = title || 'Packed Texture Preview';
        wrapper.innerHTML = '';

        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = canvas.width;
        previewCanvas.height = canvas.height;
        previewCanvas.style.maxWidth = '100%';
        previewCanvas.style.maxHeight = '450px';
        previewCanvas.style.objectFit = 'contain';
        const ctx = previewCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);

        wrapper.appendChild(previewCanvas);
        modal.style.display = 'flex';
    }

    // =========================================================================
    // SINGLE MODE LOGIC
    // =========================================================================

    setupSingleModeEventListeners() {
        const channelNames = ['red', 'green', 'blue', 'alpha'];
        
        channelNames.forEach(channel => {
            const card = document.querySelector(`.channel-card[data-channel="${channel}"]`);
            if (!card) return;

            const fileInput = card.querySelector('input[type="file"]');
            const dropZone = card.querySelector('.drop-zone');
            const clearBtn = card.querySelector('.btn-clear');
            const invertCheckbox = card.querySelector('.chk-invert');
            const customFillChk = card.querySelector('.chk-custom-fill');
            const customSlider = card.querySelector('.input-custom-slider');
            const swatch = card.querySelector('.color-swatch');
            const valText = card.querySelector('.slider-val-text');

            dropZone?.addEventListener('click', () => fileInput?.click());
            fileInput?.addEventListener('change', (e) => this.handleFileSelect(e, channel));
            clearBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearChannel(channel);
            });
            invertCheckbox?.addEventListener('change', () => this.updatePreview(channel));

            customFillChk?.addEventListener('change', () => {
                if (customSlider) customSlider.disabled = !customFillChk.checked;
            });

            customSlider?.addEventListener('input', () => {
                const val = customSlider.value;
                if (valText) valText.textContent = val;
                if (swatch) swatch.style.backgroundColor = `rgb(${val}, ${val}, ${val})`;
            });

            this.setupDragAndDrop(card, fileInput, (file) => {
                const dt = new DataTransfer();
                dt.items.add(file);
                if (fileInput) {
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });

        const packBtn = document.querySelector('[data-action="pack"]');
        const downloadBtn = document.querySelector('[data-action="download"]');
        const copyBtn = document.querySelector('[data-action="copy"]');

        packBtn?.addEventListener('click', () => this.packChannels());
        downloadBtn?.addEventListener('click', () => this.downloadResult());
        copyBtn?.addEventListener('click', () => this.copyToClipboard());
    }

    setupDragAndDrop(targetElement, fileInput, onFileDropped) {
        let dragCounter = 0;

        targetElement.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            targetElement.dataset.dragOver = 'true';
        });

        targetElement.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) delete targetElement.dataset.dragOver;
        });

        targetElement.addEventListener('dragover', (e) => e.preventDefault());

        targetElement.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            delete targetElement.dataset.dragOver;

            const files = Array.from(e.dataTransfer.files);
            const file = files.find(f => 
                this.#allowedTypes.has(f.type) || 
                f.type.startsWith('image/') || 
                f.name.toLowerCase().endsWith('.exr')
            );

            if (file) {
                onFileDropped(file);
            } else {
                this.showToast('Please drop a valid image file (PNG, JPG, WebP, BMP, EXR)', 'warning');
            }
        });
    }

    async handleFileSelect(e, channel) {
        const file = e.target.files?.[0];
        if (!file) {
            this.clearChannel(channel);
            return;
        }

        try {
            this.validateFile(file);
            const image = await this.loadImage(file);

            this.#channels.set(channel, {
                file,
                image,
                metadata: {
                    name: file.name,
                    size: file.size,
                    width: image.width,
                    height: image.height
                }
            });

            await this.updatePreview(channel);
            this.updatePackButtonState();
            
            const card = document.querySelector(`.channel-card[data-channel="${channel}"]`);
            if (card) card.dataset.hasImage = 'true';
        } catch (err) {
            this.showToast(`Error loading image: ${err.message}`, 'error');
            this.clearChannel(channel);
        }
    }

    validateFile(file) {
        if (file.size > this.#maxFileSize) {
            throw new Error(`File exceeds max size of ${this.formatSize(this.#maxFileSize)}`);
        }
    }

    async loadImage(file) {
        if (window.EXRDecoder && await window.EXRDecoder.isEXR(file)) {
            try {
                this.showToast(`Decoding OpenEXR file (${file.name})...`, 'info');
                const exrResult = await window.EXRDecoder.decodeToImage(file);
                return exrResult.image;
            } catch (err) {
                throw new Error(`EXR decoding error: ${err.message}`);
            }
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const img = new Image();

            reader.onload = (event) => {
                img.onload = () => {
                    if (img.width === 0 || img.height === 0) {
                        reject(new Error('Invalid image dimensions'));
                    } else if (img.width > this.#maxDimension || img.height > this.#maxDimension) {
                        reject(new Error(`Resolution exceeds maximum allowed ${this.#maxDimension}px`));
                    } else {
                        resolve(img);
                    }
                };
                img.onerror = () => reject(new Error('Failed to decode image file'));
                img.src = event.target.result;
            };

            reader.onerror = () => reject(new Error('Failed to read file from disk'));
            reader.readAsDataURL(file);
        });
    }

    async updatePreview(channel) {
        const card = document.querySelector(`.channel-card[data-channel="${channel}"]`);
        const dropZone = card?.querySelector('.drop-zone');
        const previewContainer = card?.querySelector('.preview-container');
        const invertCheckbox = card?.querySelector('.chk-invert');
        const channelData = this.#channels.get(channel);

        if (!card || !dropZone || !previewContainer) return;

        if (!channelData) {
            dropZone.style.display = 'flex';
            previewContainer.style.display = 'none';
            previewContainer.innerHTML = '';
            return;
        }

        const { image, metadata } = channelData;
        const isInverted = invertCheckbox?.checked || false;

        const previewCanvas = document.createElement('canvas');
        const previewSize = 140;
        previewCanvas.width = previewSize;
        previewCanvas.height = previewSize;
        const ctx = previewCanvas.getContext('2d');

        const scale = Math.min(previewSize / image.width, previewSize / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        const x = (previewSize - w) / 2;
        const y = (previewSize - h) / 2;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, previewSize, previewSize);
        ctx.drawImage(image, x, y, w, h);

        if (isInverted) {
            const imgData = ctx.getImageData(0, 0, previewSize, previewSize);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
            }
            ctx.putImageData(imgData, 0, 0);
        }

        const previewImg = document.createElement('img');
        previewImg.src = previewCanvas.toDataURL('image/png');
        previewImg.alt = `${channel} channel preview`;

        const metaText = document.createElement('div');
        metaText.className = 'preview-meta';
        metaText.innerHTML = `<strong>${this.escapeHtml(metadata.name)}</strong><br>${metadata.width}×${metadata.height}px • ${this.formatSize(metadata.size)}${isInverted ? ' (Inverted)' : ''}`;

        dropZone.style.display = 'none';
        previewContainer.style.display = 'flex';
        previewContainer.innerHTML = '';
        previewContainer.appendChild(previewImg);
        previewContainer.appendChild(metaText);
    }

    clearChannel(channel) {
        this.#channels.delete(channel);
        const card = document.querySelector(`.channel-card[data-channel="${channel}"]`);
        if (card) {
            delete card.dataset.hasImage;
            const fileInput = card.querySelector('input[type="file"]');
            const invertCheckbox = card.querySelector('.chk-invert');
            if (fileInput) fileInput.value = '';
            if (invertCheckbox) invertCheckbox.checked = false;
        }
        this.updatePreview(channel);
        this.updatePackButtonState();
    }

    updatePackButtonState() {
        const packBtn = document.querySelector('[data-action="pack"]');
        const statusHint = document.getElementById('pack-status');
        const count = this.#channels.size;

        if (packBtn && statusHint) {
            if (count >= 2) {
                packBtn.disabled = false;
                statusHint.textContent = `Ready to pack ${count} channel${count > 1 ? 's' : ''}`;
            } else {
                packBtn.disabled = true;
                statusHint.textContent = `Requires at least 2 channel images (${count}/2 selected)`;
            }
        }
    }

    async packChannels() {
        if (this.#channels.size < 2) {
            this.showToast('Please select at least 2 channels to pack.', 'warning');
            return;
        }

        const packBtn = document.querySelector('[data-action="pack"]');
        const resultSection = document.getElementById('result-section');
        const canvasContainer = document.getElementById('canvas-wrapper');

        try {
            if (packBtn) packBtn.disabled = true;
            this.showToast('Packing texture channels...', 'info');

            let targetWidth = 0, targetHeight = 0;
            this.#channels.forEach(ch => {
                if (ch.image.width > targetWidth) targetWidth = ch.image.width;
                if (ch.image.height > targetHeight) targetHeight = ch.image.height;
            });

            const rgbFillVal = parseInt(document.getElementById('rgb-fill')?.value || '0', 10);
            const alphaFillVal = parseInt(document.getElementById('alpha-fill')?.value || '255', 10);

            const customFills = {};
            ['red', 'green', 'blue', 'alpha'].forEach(ch => {
                const card = document.querySelector(`.channel-card[data-channel="${ch}"]`);
                const customChk = card?.querySelector('.chk-custom-fill');
                const slider = card?.querySelector('.input-custom-slider');
                if (customChk && customChk.checked && slider) {
                    customFills[ch] = Math.min(255, Math.max(0, parseInt(slider.value || '0', 10)));
                }
            });

            const outCanvas = await this.generatePackedCanvas(this.#channels, targetWidth, targetHeight, rgbFillVal, alphaFillVal, customFills);
            this.#resultCanvas = outCanvas;

            canvasContainer.innerHTML = '';
            canvasContainer.appendChild(outCanvas);

            document.getElementById('res-dimensions').textContent = `${targetWidth} × ${targetHeight} px`;
            document.getElementById('res-channels').textContent = Array.from(this.#channels.keys()).map(k => k.toUpperCase()).join(', ');
            
            const activeChannels = Array.from(this.#channels.keys());
            const missingChannels = ['red', 'green', 'blue', 'alpha'].filter(c => !activeChannels.includes(c));
            document.getElementById('res-missing').textContent = missingChannels.length > 0 ? missingChannels.map(k => k.toUpperCase()).join(', ') : 'None (Full RGBA)';

            resultSection.style.display = 'flex';
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            this.showToast('RGBA Texture packed successfully!', 'success');
        } catch (err) {
            this.showToast(`Packing error: ${err.message}`, 'error');
        } finally {
            this.updatePackButtonState();
        }
    }

    async generatePackedCanvas(channelsMap, targetWidth, targetHeight, rgbFill, alphaFill, customFills = {}) {
        const buffers = {};
        const channels = ['red', 'green', 'blue', 'alpha'];
        const totalPixels = targetWidth * targetHeight;

        for (const channel of channels) {
            const chData = channelsMap.get(channel);
            const channelArray = new Uint8ClampedArray(totalPixels);

            if (chData && chData.image) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = targetWidth;
                tempCanvas.height = targetHeight;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(chData.image, 0, 0, targetWidth, targetHeight);
                const rawData = tempCtx.getImageData(0, 0, targetWidth, targetHeight).data;
                const isInverted = chData.inverted || false;

                for (let i = 0; i < totalPixels; i++) {
                    const idx = i * 4;
                    let val = Math.round((rawData[idx] + rawData[idx + 1] + rawData[idx + 2]) / 3);
                    if (isInverted) val = 255 - val;
                    channelArray[i] = val;
                }
            } else {
                let fillVal;
                if (channel in customFills) fillVal = customFills[channel];
                else fillVal = (channel === 'alpha') ? alphaFill : rgbFill;
                channelArray.fill(fillVal);
            }

            buffers[channel] = channelArray;
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.id = 'result-canvas';
        outCanvas.width = targetWidth;
        outCanvas.height = targetHeight;
        const ctx = outCanvas.getContext('2d');
        const imgData = ctx.createImageData(targetWidth, targetHeight);
        const data = imgData.data;

        for (let i = 0; i < totalPixels; i++) {
            const pxIndex = i * 4;
            data[pxIndex]     = buffers.red[i];
            data[pxIndex + 1] = buffers.green[i];
            data[pxIndex + 2] = buffers.blue[i];
            data[pxIndex + 3] = buffers.alpha[i];
        }

        ctx.putImageData(imgData, 0, 0);
        return outCanvas;
    }

    async downloadResult() {
        if (!this.#resultCanvas) return;
        try {
            const blob = await new Promise(resolve => this.#resultCanvas.toBlob(resolve, 'image/png'));
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `texture_packed_${Array.from(this.#channels.keys()).join('')}_${timestamp}.png`;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            this.showToast('Download started!', 'success');
        } catch (err) {
            this.showToast(`Download failed: ${err.message}`, 'error');
        }
    }

    async copyToClipboard() {
        if (!this.#resultCanvas) return;
        try {
            const blob = await new Promise(resolve => this.#resultCanvas.toBlob(resolve, 'image/png'));
            if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                this.showToast('Packed texture copied to clipboard!', 'success');
            } else {
                throw new Error('Clipboard API not supported.');
            }
        } catch (err) {
            this.showToast(`Copy failed: ${err.message}`, 'error');
        }
    }

    // =========================================================================
    // BULK BATCH MODE LOGIC
    // =========================================================================

    setupBulkModeEventListeners() {
        const addBtn = document.querySelector('[data-action="bulk-add"]');
        const collapseToggleBtn = document.querySelector('[data-action="bulk-collapse-toggle"]');
        const packAllBtn = document.querySelector('[data-action="bulk-pack"]');
        const zipBtn = document.querySelector('[data-action="bulk-zip"]');

        addBtn?.addEventListener('click', () => this.addBulkSet());
        collapseToggleBtn?.addEventListener('click', () => this.toggleAllBulkCollapse());
        packAllBtn?.addEventListener('click', () => this.packAllBulkSets());
        zipBtn?.addEventListener('click', () => this.downloadBulkZip());
    }

    addBulkSet() {
        this.#setCounter++;
        const setId = `set_${Date.now()}_${this.#setCounter}`;
        const setName = `Texture_Set_${this.#setCounter}`;

        const setObj = {
            id: setId, name: setName, hasCustomName: false,
            channels: new Map(), customFills: {},
            collapsed: false, canvas: null, blob: null, status: 'empty'
        };

        this.#bulkSets.push(setObj);
        this.renderBulkSetCard(setObj);
        this.updateBulkToolbarState();
    }

    toggleAllBulkCollapse() {
        this.#allCollapsed = !this.#allCollapsed;
        const toggleBtn = document.querySelector('[data-action="bulk-collapse-toggle"]');
        if (toggleBtn) toggleBtn.textContent = this.#allCollapsed ? 'Expand All' : 'Collapse All';

        this.#bulkSets.forEach(setObj => {
            setObj.collapsed = this.#allCollapsed;
            const card = document.querySelector(`.bulk-set-card[data-set-id="${setObj.id}"]`);
            if (card) card.classList.toggle('collapsed', setObj.collapsed);
        });
    }

    cleanTextureBaseName(filename) {
        if (!filename) return 'Texture_Set';
        let name = filename.replace(/\.[^/.]+$/, '');
        name = name.replace(/[-_](?:1k|2k|4k|8k|16k|1080p|2160p)$/i, '');
        const mapSuffixesRegex = /[-_](?:diffuse|albedo|basecolor|color|col|normal|nrm|nor|n|roughness|rough|rgh|r|metallic|metal|met|m|occlusion|ao|ambientocclusion|height|disp|displacement|h|alpha|opacity|mask|specular|spec)$/i;
        name = name.replace(mapSuffixesRegex, '');
        name = name.replace(/[-_\s]+$/, '');
        return name || 'Texture_Set';
    }

    renderBulkSetCard(setObj) {
        const container = document.getElementById('bulk-sets-container');
        if (!container) return;

        const card = document.createElement('div');
        card.className = `bulk-set-card ${setObj.collapsed ? 'collapsed' : ''}`;
        card.dataset.setId = setObj.id;

        card.innerHTML = `
            <div class="bulk-set-header">
                <div class="bulk-set-title-group">
                    <button type="button" class="btn-collapse-set" title="Toggle set collapse">▼</button>
                    <input type="text" class="set-name-input" value="${this.escapeHtml(setObj.name)}" aria-label="Set Name">
                    <span class="badge-status" data-status="${setObj.status}">${setObj.status}</span>
                    <canvas class="set-mini-canvas" title="Packed Preview"></canvas>
                </div>
                <div class="bulk-set-actions">
                    <button type="button" class="btn-secondary btn-preview-set" title="Preview packed texture" disabled>👁 Preview</button>
                    <button type="button" class="btn-secondary btn-pack-set" title="Pack this set">Pack Set</button>
                    <button type="button" class="btn-download btn-dl-set" disabled title="Download PNG">PNG</button>
                    <button type="button" class="btn-remove-set" title="Remove Set">✕</button>
                </div>
            </div>

            <div class="bulk-set-grid">
                ${['red', 'green', 'blue', 'alpha'].map(ch => `
                    <div class="bulk-channel-box" data-channel="${ch}">
                        <button type="button" class="btn-clear-bulk-ch" title="Remove texture from ${ch} channel">✕</button>
                        <div class="bulk-channel-header">
                            <span style="color: var(--channel-${ch});">${ch.toUpperCase()} Channel</span>
                        </div>
                        <div class="drop-zone-compact">
                            <span>📁 Choose File</span>
                        </div>
                        <input type="file" accept="image/*,.exr" aria-label="${ch} channel image for ${setObj.name}">
                        <div class="bulk-preview-thumb" style="display: none;"></div>
                        
                        <div style="display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.25rem;">
                            <label class="toggle-label">
                                <input type="checkbox" class="chk-invert"> Invert
                            </label>
                            <div class="custom-fill-box">
                                <label class="toggle-label">
                                    <input type="checkbox" class="chk-custom-fill"> Custom fill
                                </label>
                                <div class="slider-fill-container">
                                    <span class="color-swatch" style="background-color: rgb(${ch === 'alpha' ? 255 : 0}, ${ch === 'alpha' ? 255 : 0}, ${ch === 'alpha' ? 255 : 0});" title="Grayscale color preview"></span>
                                    <input type="range" class="input-custom-slider" min="0" max="255" value="${ch === 'alpha' ? 255 : 0}" disabled aria-label="${ch} custom fill range slider">
                                    <span class="slider-val-text">${ch === 'alpha' ? 255 : 0}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        const collapseBtn = card.querySelector('.btn-collapse-set');
        const nameInput = card.querySelector('.set-name-input');
        const removeBtn = card.querySelector('.btn-remove-set');
        const packSetBtn = card.querySelector('.btn-pack-set');
        const previewSetBtn = card.querySelector('.btn-preview-set');
        const dlSetBtn = card.querySelector('.btn-dl-set');

        collapseBtn.addEventListener('click', () => {
            setObj.collapsed = !setObj.collapsed;
            card.classList.toggle('collapsed', setObj.collapsed);
        });

        nameInput.addEventListener('input', (e) => {
            setObj.name = e.target.value.trim() || 'Texture_Set';
            setObj.hasCustomName = true;
        });

        removeBtn.addEventListener('click', () => this.removeBulkSet(setObj.id));
        packSetBtn.addEventListener('click', () => this.packSingleBulkSet(setObj));
        dlSetBtn.addEventListener('click', () => this.downloadSingleBulkSet(setObj));
        
        previewSetBtn.addEventListener('click', () => {
            if (setObj.canvas) {
                this.showPreviewModal(setObj.canvas, `Preview: ${setObj.name}`);
            }
        });

        const channelBoxes = card.querySelectorAll('.bulk-channel-box');
        channelBoxes.forEach(box => {
            const ch = box.dataset.channel;
            const fileInput = box.querySelector('input[type="file"]');
            const dropZone = box.querySelector('.drop-zone-compact');
            const chkInvert = box.querySelector('.chk-invert');
            const chkCustomFill = box.querySelector('.chk-custom-fill');
            const customSlider = box.querySelector('.input-custom-slider');
            const swatch = box.querySelector('.color-swatch');
            const valText = box.querySelector('.slider-val-text');
            const clearChBtn = box.querySelector('.btn-clear-bulk-ch');

            dropZone.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (file) await this.handleBulkChannelFile(setObj, ch, file, box);
            });

            clearChBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearBulkChannel(setObj, ch, box);
            });

            chkInvert.addEventListener('change', () => {
                const chData = setObj.channels.get(ch);
                if (chData) {
                    chData.inverted = chkInvert.checked;
                    this.updateBulkChannelBoxPreview(box, chData);
                }
            });

            chkCustomFill.addEventListener('change', () => {
                customSlider.disabled = !chkCustomFill.checked;
                if (chkCustomFill.checked) {
                    setObj.customFills[ch] = Math.min(255, Math.max(0, parseInt(customSlider.value || '0', 10)));
                } else {
                    delete setObj.customFills[ch];
                }
            });

            customSlider.addEventListener('input', () => {
                const val = customSlider.value;
                valText.textContent = val;
                swatch.style.backgroundColor = `rgb(${val}, ${val}, ${val})`;
                if (chkCustomFill.checked) setObj.customFills[ch] = parseInt(val, 10);
            });

            this.setupDragAndDrop(box, fileInput, async (file) => {
                const dt = new DataTransfer();
                dt.items.add(file);
                fileInput.files = dt.files;
                await this.handleBulkChannelFile(setObj, ch, file, box);
            });
        });

        container.appendChild(card);
    }

    clearBulkChannel(setObj, channel, channelBox) {
        setObj.channels.delete(channel);
        delete channelBox.dataset.hasImage;

        const fileInput = channelBox.querySelector('input[type="file"]');
        const chkInvert = channelBox.querySelector('.chk-invert');
        if (fileInput) fileInput.value = '';
        if (chkInvert) chkInvert.checked = false;

        const dropZone = channelBox.querySelector('.drop-zone-compact');
        const previewThumb = channelBox.querySelector('.bulk-preview-thumb');
        if (dropZone) dropZone.style.display = 'flex';
        if (previewThumb) { previewThumb.style.display = 'none'; previewThumb.innerHTML = ''; }

        if (setObj.channels.size < 2) {
            setObj.status = setObj.channels.size === 0 ? 'empty' : 'ready';
            this.updateSetStatusBadge(setObj.id, setObj.channels.size === 0 ? 'empty' : 'ready');
        }
        this.updateBulkToolbarState();
    }

    async handleBulkChannelFile(setObj, channel, file, channelBox) {
        try {
            this.validateFile(file);
            const image = await this.loadImage(file);
            const chkInvert = channelBox.querySelector('.chk-invert');
            const isFirstTextureInSet = (setObj.channels.size === 0);

            setObj.channels.set(channel, {
                file, image,
                inverted: chkInvert?.checked || false,
                metadata: { width: image.width, height: image.height }
            });

            if (!setObj.hasCustomName && isFirstTextureInSet) {
                const autoName = this.cleanTextureBaseName(file.name);
                setObj.name = autoName;
                const card = document.querySelector(`.bulk-set-card[data-set-id="${setObj.id}"]`);
                const nameInput = card?.querySelector('.set-name-input');
                if (nameInput) nameInput.value = autoName;
            }

            channelBox.dataset.hasImage = 'true';
            this.updateBulkChannelBoxPreview(channelBox, setObj.channels.get(channel));
            
            if (setObj.channels.size >= 2) {
                setObj.status = 'ready';
                this.updateSetStatusBadge(setObj.id, 'ready');
            }
            this.updateBulkToolbarState();
        } catch (err) {
            this.showToast(`Error loading ${channel} channel: ${err.message}`, 'error');
        }
    }

    updateBulkChannelBoxPreview(box, chData) {
        const dropZone = box.querySelector('.drop-zone-compact');
        const previewThumb = box.querySelector('.bulk-preview-thumb');

        if (!chData) {
            dropZone.style.display = 'flex';
            previewThumb.style.display = 'none';
            return;
        }

        const { image, file, inverted } = chData;
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 60; thumbCanvas.height = 60;
        const ctx = thumbCanvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 60, 60);
        ctx.drawImage(image, 0, 0, 60, 60);

        if (inverted) {
            const imgData = ctx.getImageData(0, 0, 60, 60);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = 255 - d[i]; d[i+1] = 255 - d[i+1]; d[i+2] = 255 - d[i+2];
            }
            ctx.putImageData(imgData, 0, 0);
        }

        dropZone.style.display = 'none';
        previewThumb.style.display = 'flex';
        previewThumb.innerHTML = `
            <img src="${thumbCanvas.toDataURL('image/png')}" alt="Channel thumb">
            <div class="bulk-preview-meta">${this.escapeHtml(file.name)}<br>${image.width}×${image.height}</div>
        `;
    }

    removeBulkSet(setId) {
        this.#bulkSets = this.#bulkSets.filter(s => s.id !== setId);
        document.querySelector(`.bulk-set-card[data-set-id="${setId}"]`)?.remove();
        this.updateBulkToolbarState();
    }

    updateSetStatusBadge(setId, status) {
        const card = document.querySelector(`.bulk-set-card[data-set-id="${setId}"]`);
        const badge = card?.querySelector('.badge-status');
        if (badge) { badge.dataset.status = status; badge.textContent = status; }
    }

    async packSingleBulkSet(setObj) {
        if (setObj.channels.size < 2) {
            this.showToast(`Set "${setObj.name}" requires at least 2 channels.`, 'warning');
            return null;
        }

        try {
            let targetWidth = 0, targetHeight = 0;
            setObj.channels.forEach(ch => {
                if (ch.image.width > targetWidth) targetWidth = ch.image.width;
                if (ch.image.height > targetHeight) targetHeight = ch.image.height;
            });

            const rgbFillVal = parseInt(document.getElementById('rgb-fill')?.value || '0', 10);
            const alphaFillVal = parseInt(document.getElementById('alpha-fill')?.value || '255', 10);

            const canvas = await this.generatePackedCanvas(setObj.channels, targetWidth, targetHeight, rgbFillVal, alphaFillVal, setObj.customFills);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            setObj.canvas = canvas;
            setObj.blob = blob;
            setObj.status = 'packed';

            this.updateSetStatusBadge(setObj.id, 'packed');
            const card = document.querySelector(`.bulk-set-card[data-set-id="${setObj.id}"]`);
            const dlBtn = card?.querySelector('.btn-dl-set');
            const previewBtn = card?.querySelector('.btn-preview-set');
            const miniCanvas = card?.querySelector('.set-mini-canvas');

            if (dlBtn) dlBtn.disabled = false;
            if (previewBtn) previewBtn.disabled = false;
            if (miniCanvas) {
                miniCanvas.width = 50; miniCanvas.height = 50;
                miniCanvas.getContext('2d').drawImage(canvas, 0, 0, 50, 50);
                miniCanvas.style.display = 'block';
            }

            this.updateBulkToolbarState();
            return blob;
        } catch (err) {
            this.showToast(`Failed to pack set "${setObj.name}": ${err.message}`, 'error');
            return null;
        }
    }

    async packAllBulkSets() {
        const readySets = this.#bulkSets.filter(s => s.channels.size >= 2);
        if (readySets.length === 0) {
            this.showToast('No ready texture sets to pack.', 'warning');
            return;
        }
        this.showToast(`Batch packing ${readySets.length} set(s)...`, 'info');
        let packedCount = 0;
        for (const setObj of readySets) {
            if (await this.packSingleBulkSet(setObj)) packedCount++;
        }
        if (packedCount > 0) this.showToast(`Batch complete! ${packedCount} set(s) packed.`, 'success');
    }

    downloadSingleBulkSet(setObj) {
        if (!setObj.blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(setObj.blob);
        link.download = `${setObj.name || 'packed_texture'}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }

    async downloadBulkZip() {
        const packedSets = this.#bulkSets.filter(s => s.blob !== null);
        if (packedSets.length === 0) { this.showToast('No packed textures to zip.', 'warning'); return; }
        if (typeof window.JSZip === 'undefined') { this.showToast('JSZip library is missing.', 'error'); return; }

        try {
            this.showToast('Generating ZIP...', 'info');
            const zip = new window.JSZip();
            packedSets.forEach((setObj, i) => {
                zip.file(`${setObj.name || `packed_set_${i + 1}`}.png`, setObj.blob);
            });
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `packed_textures_batch_${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            this.showToast('ZIP download started!', 'success');
        } catch (err) {
            this.showToast(`ZIP failed: ${err.message}`, 'error');
        }
    }

    updateBulkToolbarState() {
        const zipBtn = document.querySelector('[data-action="bulk-zip"]');
        const packedCount = this.#bulkSets.filter(s => s.blob !== null).length;
        if (zipBtn) {
            zipBtn.disabled = packedCount === 0;
            zipBtn.textContent = packedCount > 0 ? `Download All (${packedCount} ZIP)` : 'Download All (ZIP)';
        }
    }

    // =========================================================================
    // NORMAL MAP CONVERTER BATCH LOGIC
    // =========================================================================

    setupNormalModeEventListeners() {
        const dropZone = document.getElementById('normal-drop-zone');
        const fileInput = document.getElementById('normal-file-input');
        const presetSelect = document.getElementById('normal-mode-preset');
        const convertAllBtn = document.getElementById('btn-normal-convert-all');
        const zipBtn = document.getElementById('btn-normal-zip');
        const chkGreen = document.getElementById('norm-inv-green');
        const chkRed = document.getElementById('norm-inv-red');
        const chkBlue = document.getElementById('norm-inv-blue');

        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => this.addFilesToNormalQueue(Array.from(e.target.files || [])));

        presetSelect?.addEventListener('change', () => {
            const val = presetSelect.value;
            if (val === 'dx-to-gl' || val === 'gl-to-dx') {
                if (chkGreen) chkGreen.checked = true;
                if (chkRed) chkRed.checked = false;
                if (chkBlue) chkBlue.checked = false;
            }
        });

        convertAllBtn?.addEventListener('click', () => this.convertAllNormalMaps());
        zipBtn?.addEventListener('click', () => this.downloadNormalZip());
        this.setupDragAndDrop(dropZone, fileInput, (file) => this.addFilesToNormalQueue([file]));
    }

    async addFilesToNormalQueue(files) {
        const validFiles = files.filter(f => this.#allowedTypes.has(f.type) || f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.exr'));
        for (const file of validFiles) {
            try {
                this.validateFile(file);
                const image = await this.loadImage(file);
                this.#normalCounter++;
                const item = { id: `norm_${Date.now()}_${this.#normalCounter}`, file, image, name: file.name, status: 'ready', canvas: null, blob: null };
                this.#normalQueue.push(item);
                this.renderNormalQueueItem(item);
            } catch (err) {
                this.showToast(`Error adding ${file.name}: ${err.message}`, 'error');
            }
        }
        this.updateNormalToolbarState();
    }

    renderNormalQueueItem(item) {
        const container = document.getElementById('normal-queue-container');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'normal-card';
        card.dataset.normalId = item.id;
        const srcThumbUrl = this.createThumbDataUrl(item.image);

        card.innerHTML = `
            <div class="normal-card-preview">
                <img src="${srcThumbUrl}" class="normal-thumb" alt="Original" title="Original">
                <span class="normal-arrow">➔</span>
                <img src="${srcThumbUrl}" class="normal-thumb normal-out-thumb" alt="Converted" title="Converted">
            </div>
            <div class="normal-info-group">
                <span class="normal-file-title">${this.escapeHtml(item.name)}</span>
                <span class="normal-file-meta">${item.image.width} × ${item.image.height} px • ${this.formatSize(item.file.size)}</span>
            </div>
            <div class="normal-card-actions">
                <span class="badge-status" data-status="${item.status}">${item.status}</span>
                <button type="button" class="btn-secondary btn-convert-single" title="Convert">Convert</button>
                <button type="button" class="btn-download btn-dl-normal" disabled title="Download PNG">PNG</button>
                <button type="button" class="btn-remove-set btn-remove-normal" title="Remove">✕</button>
            </div>
        `;

        card.querySelector('.btn-convert-single').addEventListener('click', () => this.processNormalMapItem(item));
        card.querySelector('.btn-dl-normal').addEventListener('click', () => {
            if (item.blob) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(item.blob);
                const suffix = (document.getElementById('normal-mode-preset')?.value === 'dx-to-gl') ? '_OpenGL' : '_DirectX';
                link.download = `${item.name.replace(/\.[^/.]+$/, '')}${suffix}.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            }
        });
        card.querySelector('.btn-remove-normal').addEventListener('click', () => {
            this.#normalQueue = this.#normalQueue.filter(n => n.id !== item.id);
            card.remove();
            this.updateNormalToolbarState();
        });

        container.appendChild(card);
    }

    createThumbDataUrl(image) {
        const c = document.createElement('canvas');
        c.width = 60; c.height = 60;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 60, 60);
        ctx.drawImage(image, 0, 0, 60, 60);
        return c.toDataURL('image/png');
    }

    async processNormalMapItem(item) {
        try {
            const { width, height } = item.image;
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(item.image, 0, 0, width, height);

            const invG = document.getElementById('norm-inv-green')?.checked || false;
            const invR = document.getElementById('norm-inv-red')?.checked || false;
            const invB = document.getElementById('norm-inv-blue')?.checked || false;
            const imgData = ctx.getImageData(0, 0, width, height);
            const d = imgData.data;

            for (let i = 0; i < d.length; i += 4) {
                if (invR) d[i] = 255 - d[i];
                if (invG) d[i+1] = 255 - d[i+1];
                if (invB) d[i+2] = 255 - d[i+2];
            }
            ctx.putImageData(imgData, 0, 0);

            item.canvas = canvas;
            item.blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            item.status = 'converted';

            const card = document.querySelector(`.normal-card[data-normal-id="${item.id}"]`);
            if (card) {
                const outThumb = card.querySelector('.normal-out-thumb');
                const badge = card.querySelector('.badge-status');
                const dlBtn = card.querySelector('.btn-dl-normal');
                if (outThumb) outThumb.src = this.createThumbDataUrl(canvas);
                if (badge) { badge.dataset.status = 'converted'; badge.textContent = 'converted'; }
                if (dlBtn) dlBtn.disabled = false;
            }
            this.updateNormalToolbarState();
            return item.blob;
        } catch (err) {
            this.showToast(`Error: ${err.message}`, 'error');
            return null;
        }
    }

    async convertAllNormalMaps() {
        if (this.#normalQueue.length === 0) return;
        this.showToast(`Converting ${this.#normalQueue.length} normal map(s)...`, 'info');
        let count = 0;
        for (const item of this.#normalQueue) { if (await this.processNormalMapItem(item)) count++; }
        if (count > 0) this.showToast(`Converted ${count} normal map(s)!`, 'success');
    }

    async downloadNormalZip() {
        const converted = this.#normalQueue.filter(n => n.blob !== null);
        if (converted.length === 0 || typeof window.JSZip === 'undefined') return;

        try {
            const zip = new window.JSZip();
            const suffix = (document.getElementById('normal-mode-preset')?.value === 'dx-to-gl') ? '_OpenGL' : '_DirectX';
            converted.forEach(item => zip.file(`${item.name.replace(/\.[^/.]+$/, '')}${suffix}.png`, item.blob));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `normal_maps_converted_${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            this.showToast('Normal Maps ZIP started!', 'success');
        } catch (err) {
            this.showToast(`ZIP failed: ${err.message}`, 'error');
        }
    }

    updateNormalToolbarState() {
        const countHint = document.getElementById('normal-queue-count');
        const convertAllBtn = document.getElementById('btn-normal-convert-all');
        const zipBtn = document.getElementById('btn-normal-zip');
        const total = this.#normalQueue.length;
        const convertedCount = this.#normalQueue.filter(n => n.blob !== null).length;

        if (countHint) countHint.textContent = `Queue: ${total} normal map${total === 1 ? '' : 's'}`;
        if (convertAllBtn) convertAllBtn.disabled = total === 0;
        if (zipBtn) {
            zipBtn.disabled = convertedCount === 0;
            zipBtn.textContent = convertedCount > 0 ? `Download All (${convertedCount} ZIP)` : 'Download All (ZIP)';
        }
    }

    // =========================================================================
    // HEIGHT-TO-NORMAL GENERATOR BATCH LOGIC (SOBEL FILTER)
    // =========================================================================

    setupH2NModeEventListeners() {
        const dropZone = document.getElementById('h2n-drop-zone');
        const fileInput = document.getElementById('h2n-file-input');
        const strengthSlider = document.getElementById('h2n-strength-slider');
        const strengthValText = document.getElementById('h2n-strength-val');
        const generateAllBtn = document.getElementById('btn-h2n-generate-all');
        const zipBtn = document.getElementById('btn-h2n-zip');

        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => this.addFilesToH2NQueue(Array.from(e.target.files || [])));

        strengthSlider?.addEventListener('input', () => {
            if (strengthValText) strengthValText.textContent = parseFloat(strengthSlider.value).toFixed(1);
        });

        generateAllBtn?.addEventListener('click', () => this.generateAllH2NMaps());
        zipBtn?.addEventListener('click', () => this.downloadH2NZip());

        if (dropZone) this.setupDragAndDrop(dropZone, fileInput, (file) => this.addFilesToH2NQueue([file]));
    }

    async addFilesToH2NQueue(files) {
        const validFiles = files.filter(f => this.#allowedTypes.has(f.type) || f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.exr'));
        for (const file of validFiles) {
            try {
                this.validateFile(file);
                const image = await this.loadImage(file);
                this.#h2nCounter++;
                const item = {
                    id: `h2n_${Date.now()}_${this.#h2nCounter}`,
                    file, image, name: file.name, status: 'ready', canvas: null, blob: null
                };
                this.#h2nQueue.push(item);
                this.renderH2NQueueItem(item);
            } catch (err) {
                this.showToast(`Error adding ${file.name}: ${err.message}`, 'error');
            }
        }
        this.updateH2NToolbarState();
    }

    renderH2NQueueItem(item) {
        const container = document.getElementById('h2n-queue-container');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'normal-card';
        card.dataset.h2nId = item.id;
        const srcThumbUrl = this.createThumbDataUrl(item.image);

        card.innerHTML = `
            <div class="normal-card-preview">
                <img src="${srcThumbUrl}" class="normal-thumb" alt="Heightmap" title="Heightmap Source">
                <span class="normal-arrow">➔</span>
                <img src="${srcThumbUrl}" class="normal-thumb normal-out-thumb" alt="Normal Map" title="Generated Normal Map">
            </div>
            <div class="normal-info-group">
                <span class="normal-file-title">${this.escapeHtml(item.name)}</span>
                <span class="normal-file-meta">${item.image.width} × ${item.image.height} px • ${this.formatSize(item.file.size)}</span>
            </div>
            <div class="normal-card-actions">
                <span class="badge-status" data-status="${item.status}">${item.status}</span>
                <button type="button" class="btn-secondary btn-generate-single" title="Generate Normal Map">Generate</button>
                <button type="button" class="btn-download btn-dl-h2n" disabled title="Download PNG">PNG</button>
                <button type="button" class="btn-remove-set btn-remove-h2n" title="Remove">✕</button>
            </div>
        `;

        card.querySelector('.btn-generate-single').addEventListener('click', () => this.processH2NItem(item));
        card.querySelector('.btn-dl-h2n').addEventListener('click', () => {
            if (item.blob) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(item.blob);
                const suffix = (document.getElementById('h2n-preset')?.value === 'directx') ? '_NormalDirectX' : '_NormalOpenGL';
                link.download = `${item.name.replace(/\.[^/.]+$/, '')}${suffix}.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            }
        });
        card.querySelector('.btn-remove-h2n').addEventListener('click', () => {
            this.#h2nQueue = this.#h2nQueue.filter(h => h.id !== item.id);
            card.remove();
            this.updateH2NToolbarState();
        });

        container.appendChild(card);
    }

    async processH2NItem(item) {
        try {
            const strength = parseFloat(document.getElementById('h2n-strength-slider')?.value || '5.0');
            const isDirectX = (document.getElementById('h2n-preset')?.value === 'directx');
            const invertHeight = document.getElementById('h2n-invert-height')?.checked || false;
            const wrapEdges = document.getElementById('h2n-wrap-edges')?.checked || false;

            const canvas = this.generateNormalFromHeight(item.image, strength, isDirectX, invertHeight, wrapEdges);
            item.canvas = canvas;
            item.blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            item.status = 'converted';

            const card = document.querySelector(`.normal-card[data-h2n-id="${item.id}"]`);
            if (card) {
                const outThumb = card.querySelector('.normal-out-thumb');
                const badge = card.querySelector('.badge-status');
                const dlBtn = card.querySelector('.btn-dl-h2n');

                if (outThumb) outThumb.src = this.createThumbDataUrl(canvas);
                if (badge) { badge.dataset.status = 'converted'; badge.textContent = 'generated'; }
                if (dlBtn) dlBtn.disabled = false;
            }

            this.updateH2NToolbarState();
            return item.blob;
        } catch (err) {
            this.showToast(`Error generating normal map: ${err.message}`, 'error');
            return null;
        }
    }

    generateNormalFromHeight(image, strength, isDirectX, invertHeight, wrapEdges) {
        const width = image.width;
        const height = image.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);

        const srcData = ctx.getImageData(0, 0, width, height).data;
        const outImgData = ctx.createImageData(width, height);
        const outData = outImgData.data;

        // Convert source image to 1D grayscale float array (0.0 to 1.0)
        const grayscale = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            let v = (srcData[idx] * 0.299 + srcData[idx + 1] * 0.587 + srcData[idx + 2] * 0.114) / 255.0;
            if (invertHeight) v = 1.0 - v;
            grayscale[i] = v;
        }

        const getH = (x, y) => {
            if (wrapEdges) {
                x = (x + width) % width;
                y = (y + height) % height;
            } else {
                x = Math.max(0, Math.min(width - 1, x));
                y = Math.max(0, Math.min(height - 1, y));
            }
            return grayscale[y * width + x];
        };

        // Sobel 3x3 Filter Kernel Pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tl = getH(x - 1, y - 1);
                const l  = getH(x - 1, y);
                const bl = getH(x - 1, y + 1);
                const t  = getH(x, y - 1);
                const b  = getH(x, y + 1);
                const tr = getH(x + 1, y - 1);
                const r  = getH(x + 1, y);
                const br = getH(x + 1, y + 1);

                // dX = Horizontal Slope, dY = Vertical Slope
                const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
                const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

                let nx = -dX * strength;
                let ny = isDirectX ? (dY * strength) : (-dY * strength);
                let nz = 1.0;

                // Normalize 3D Normal Vector
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                nx /= len;
                ny /= len;
                nz /= len;

                // Map vector (-1.0 to +1.0) -> RGB (0 to 255)
                const pixelIdx = (y * width + x) * 4;
                outData[pixelIdx]     = Math.round((nx * 0.5 + 0.5) * 255); // Red (X)
                outData[pixelIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255); // Green (Y)
                outData[pixelIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255); // Blue (Z)
                outData[pixelIdx + 3] = 255;                                // Alpha
            }
        }

        ctx.putImageData(outImgData, 0, 0);
        return canvas;
    }

    async generateAllH2NMaps() {
        if (this.#h2nQueue.length === 0) return;
        this.showToast(`Generating normal maps for ${this.#h2nQueue.length} heightmap(s)...`, 'info');
        let count = 0;
        for (const item of this.#h2nQueue) {
            if (await this.processH2NItem(item)) count++;
        }
        if (count > 0) this.showToast(`Generated ${count} normal map(s)!`, 'success');
    }

    async downloadH2NZip() {
        const generated = this.#h2nQueue.filter(h => h.blob !== null);
        if (generated.length === 0 || typeof window.JSZip === 'undefined') return;

        try {
            const zip = new window.JSZip();
            const suffix = (document.getElementById('h2n-preset')?.value === 'directx') ? '_NormalDirectX' : '_NormalOpenGL';

            generated.forEach(item => {
                const baseName = item.name.replace(/\.[^/.]+$/, '');
                zip.file(`${baseName}${suffix}.png`, item.blob);
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `generated_normal_maps_${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            this.showToast('Generated Normal Maps ZIP started!', 'success');
        } catch (err) {
            this.showToast(`ZIP failed: ${err.message}`, 'error');
        }
    }

    updateH2NToolbarState() {
        const countHint = document.getElementById('h2n-queue-count');
        const generateAllBtn = document.getElementById('btn-h2n-generate-all');
        const zipBtn = document.getElementById('btn-h2n-zip');
        const total = this.#h2nQueue.length;
        const genCount = this.#h2nQueue.filter(h => h.blob !== null).length;

        if (countHint) countHint.textContent = `Queue: ${total} heightmap${total === 1 ? '' : 's'}`;
        if (generateAllBtn) generateAllBtn.disabled = total === 0;
        if (zipBtn) {
            zipBtn.disabled = genCount === 0;
            zipBtn.textContent = genCount > 0 ? `Download All (${genCount} ZIP)` : 'Download All (ZIP)';
        }
    }

    // =========================================================================
    // CHANNEL SPLITTER LOGIC
    // =========================================================================

    setupSplitterModeEventListeners() {
        const dropZone = document.getElementById('splitter-drop-zone');
        const fileInput = document.getElementById('splitter-file-input');
        const splitAllBtn = document.getElementById('btn-splitter-split-all');
        const zipBtn = document.getElementById('btn-splitter-zip');

        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => this.addFilesToSplitterQueue(Array.from(e.target.files || [])));
        splitAllBtn?.addEventListener('click', () => this.splitAllTextures());
        zipBtn?.addEventListener('click', () => this.downloadSplitterZip());
        if (dropZone) this.setupDragAndDrop(dropZone, fileInput, (file) => this.addFilesToSplitterQueue([file]));
    }

    async addFilesToSplitterQueue(files) {
        const validFiles = files.filter(f => this.#allowedTypes.has(f.type) || f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.exr'));
        for (const file of validFiles) {
            try {
                this.validateFile(file);
                const image = await this.loadImage(file);
                this.#splitterCounter++;
                const item = {
                    id: `split_${Date.now()}_${this.#splitterCounter}`,
                    file, image, name: file.name,
                    status: 'ready',
                    channelBlobs: { red: null, green: null, blue: null, alpha: null },
                    channelCanvases: { red: null, green: null, blue: null, alpha: null }
                };
                this.#splitterQueue.push(item);
                this.renderSplitterQueueItem(item);
            } catch (err) {
                this.showToast(`Error adding ${file.name}: ${err.message}`, 'error');
            }
        }
        this.updateSplitterToolbarState();
    }

    renderSplitterQueueItem(item) {
        const container = document.getElementById('splitter-queue-container');
        if (!container) return;

        const card = document.createElement('div');
        card.className = 'splitter-card';
        card.dataset.splitterId = item.id;
        const srcThumbUrl = this.createThumbDataUrl(item.image);

        card.innerHTML = `
            <div class="splitter-card-header">
                <div class="splitter-source-info">
                    <img src="${srcThumbUrl}" class="splitter-source-thumb" alt="Source texture">
                    <div class="splitter-source-meta">
                        <span class="normal-file-title">${this.escapeHtml(item.name)}</span>
                        <span class="normal-file-meta">${item.image.width} × ${item.image.height} px • ${this.formatSize(item.file.size)}</span>
                    </div>
                </div>
                <div class="splitter-card-actions">
                    <span class="badge-status" data-status="${item.status}">${item.status}</span>
                    <button type="button" class="btn-secondary btn-split-single" title="Split into channels">Split</button>
                    <button type="button" class="btn-remove-set" title="Remove">✕</button>
                </div>
            </div>
            <div class="splitter-channels-grid">
                ${['red', 'green', 'blue', 'alpha'].map(ch => `
                    <div class="splitter-channel-output" data-channel="${ch}">
                        <span class="channel-badge" style="background: var(--channel-${ch});">${ch[0].toUpperCase()}</span>
                        <div class="splitter-ch-preview" style="min-height: 60px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.7rem;">
                            Waiting...
                        </div>
                        <button type="button" class="btn-download btn-dl-ch" disabled title="Download ${ch.toUpperCase()} channel">${ch.toUpperCase()} PNG</button>
                    </div>
                `).join('')}
            </div>
        `;

        card.querySelector('.btn-split-single').addEventListener('click', () => this.splitSingleTexture(item));
        card.querySelector('.btn-remove-set').addEventListener('click', () => {
            this.#splitterQueue = this.#splitterQueue.filter(s => s.id !== item.id);
            card.remove();
            this.updateSplitterToolbarState();
        });

        ['red', 'green', 'blue', 'alpha'].forEach(ch => {
            const dlBtn = card.querySelector(`.splitter-channel-output[data-channel="${ch}"] .btn-dl-ch`);
            dlBtn?.addEventListener('click', () => {
                const blob = item.channelBlobs[ch];
                if (blob) {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `${item.name.replace(/\.[^/.]+$/, '')}_${ch.toUpperCase()}.png`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
                }
            });
        });

        container.appendChild(card);
    }

    async splitSingleTexture(item) {
        try {
            const { width, height } = item.image;
            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = width; srcCanvas.height = height;
            const srcCtx = srcCanvas.getContext('2d');
            srcCtx.drawImage(item.image, 0, 0, width, height);
            const srcData = srcCtx.getImageData(0, 0, width, height).data;

            const channelNames = ['red', 'green', 'blue', 'alpha'];
            const channelIndices = [0, 1, 2, 3];

            for (let ci = 0; ci < 4; ci++) {
                const ch = channelNames[ci];
                const offset = channelIndices[ci];

                const chCanvas = document.createElement('canvas');
                chCanvas.width = width; chCanvas.height = height;
                const chCtx = chCanvas.getContext('2d');
                const chImgData = chCtx.createImageData(width, height);
                const d = chImgData.data;

                for (let i = 0; i < width * height; i++) {
                    const srcIdx = i * 4;
                    const val = srcData[srcIdx + offset];
                    const dstIdx = i * 4;
                    d[dstIdx] = val;
                    d[dstIdx + 1] = val;
                    d[dstIdx + 2] = val;
                    d[dstIdx + 3] = 255;
                }

                chCtx.putImageData(chImgData, 0, 0);
                item.channelCanvases[ch] = chCanvas;
                item.channelBlobs[ch] = await new Promise(resolve => chCanvas.toBlob(resolve, 'image/png'));
            }

            item.status = 'split';

            const card = document.querySelector(`.splitter-card[data-splitter-id="${item.id}"]`);
            if (card) {
                const badge = card.querySelector('.badge-status');
                if (badge) { badge.dataset.status = 'split'; badge.textContent = 'split'; }

                channelNames.forEach(ch => {
                    const outputBox = card.querySelector(`.splitter-channel-output[data-channel="${ch}"]`);
                    const previewArea = outputBox?.querySelector('.splitter-ch-preview');
                    const dlBtn = outputBox?.querySelector('.btn-dl-ch');

                    if (previewArea && item.channelCanvases[ch]) {
                        const thumbUrl = this.createThumbDataUrl(item.channelCanvases[ch]);
                        previewArea.innerHTML = `<img src="${thumbUrl}" alt="${ch} channel" style="width:100%;max-height:80px;object-fit:contain;border-radius:4px;">`;
                    }
                    if (dlBtn) dlBtn.disabled = false;
                });
            }

            this.updateSplitterToolbarState();
            return true;
        } catch (err) {
            this.showToast(`Error splitting "${item.name}": ${err.message}`, 'error');
            return false;
        }
    }

    async splitAllTextures() {
        if (this.#splitterQueue.length === 0) return;
        this.showToast(`Splitting ${this.#splitterQueue.length} texture(s)...`, 'info');
        let count = 0;
        for (const item of this.#splitterQueue) { if (await this.splitSingleTexture(item)) count++; }
        if (count > 0) this.showToast(`Split ${count} texture(s) into individual channels!`, 'success');
    }

    async downloadSplitterZip() {
        const splitItems = this.#splitterQueue.filter(s => s.status === 'split');
        if (splitItems.length === 0 || typeof window.JSZip === 'undefined') return;

        try {
            this.showToast('Generating ZIP of split channels...', 'info');
            const zip = new window.JSZip();

            splitItems.forEach(item => {
                const baseName = item.name.replace(/\.[^/.]+$/, '');
                ['red', 'green', 'blue', 'alpha'].forEach(ch => {
                    if (item.channelBlobs[ch]) {
                        zip.file(`${baseName}_${ch.toUpperCase()}.png`, item.channelBlobs[ch]);
                    }
                });
            });

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `split_channels_${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            this.showToast('Split channels ZIP started!', 'success');
        } catch (err) {
            this.showToast(`ZIP failed: ${err.message}`, 'error');
        }
    }

    updateSplitterToolbarState() {
        const countHint = document.getElementById('splitter-queue-count');
        const splitAllBtn = document.getElementById('btn-splitter-split-all');
        const zipBtn = document.getElementById('btn-splitter-zip');
        const total = this.#splitterQueue.length;
        const splitCount = this.#splitterQueue.filter(s => s.status === 'split').length;

        if (countHint) countHint.textContent = `Queue: ${total} texture${total === 1 ? '' : 's'}`;
        if (splitAllBtn) splitAllBtn.disabled = total === 0;
        if (zipBtn) {
            zipBtn.disabled = splitCount === 0;
            zipBtn.textContent = splitCount > 0 ? `Download All (${splitCount} ZIP)` : 'Download All (ZIP)';
        }
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.dataset.type = type;
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
        toast.innerHTML = `<span style="font-weight:bold;">${icon}</span> <span>${this.escapeHtml(message)}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
    }
}

new RGBAChannelPacker();
