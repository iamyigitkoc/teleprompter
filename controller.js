class TeleprompterController {
    constructor() {
        this.ws = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        this.segmentDuration = 10 * 60 * 1000;
        this.speed = 150;
        this.fontSize = 48;
        this.scrollAmount = 30;
        this.timerInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        // Flag to prevent echo when receiving state updates
        this.isReceivingUpdate = false;
        
        this.initializeElements();
        this.bindEvents();
        this.connectWebSocket();
        this.updateDisplayUrl();
    }
    
    initializeElements() {
        this.fileUpload = document.getElementById('file-upload');
        this.clearBtn = document.getElementById('clear-text');
        this.speedControl = document.getElementById('speed-control');
        this.speedDisplay = document.getElementById('speed-display');
        this.segmentMinutesInput = document.getElementById('segment-minutes');
        this.segmentSecondsInput = document.getElementById('segment-seconds');
        this.fontSizeControl = document.getElementById('font-size');
        this.fontSizeDisplay = document.getElementById('font-size-display');
        this.mirrorModeCheckbox = document.getElementById('mirror-mode');
        this.hideTimerCheckbox = document.getElementById('hide-timer');
        this.onAirModeCheckbox = document.getElementById('on-air-mode');
        this.scheduledStartInput = document.getElementById('scheduled-start');
        this.clearScheduleBtn = document.getElementById('clear-schedule');
        this.scheduleInfo = document.getElementById('schedule-info');
        this.startBtn = document.getElementById('start-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.textPreview = document.getElementById('text-preview');
        this.wordCount = document.getElementById('word-count');
        this.expectedDuration = document.getElementById('expected-duration');
        this.durationDiff = document.getElementById('duration-diff');
        this.diffValue = document.getElementById('diff-value');
        this.segmentTimer = document.getElementById('segment-timer');
        this.elapsedTimer = document.getElementById('elapsed-timer');
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.displayUrl = document.getElementById('display-url');
        this.copyUrlBtn = document.getElementById('copy-url');
        this.formatBtn = document.getElementById('format-text');
        this.formattingOptions = document.getElementById('formatting-options');
        this.autoFormatCheckbox = document.getElementById('auto-format');
        this.formatCapsCheckbox = document.getElementById('format-caps');
        this.formatSentencesCheckbox = document.getElementById('format-sentences');
        this.formatParagraphsCheckbox = document.getElementById('format-paragraphs');
        this.formatPunctuationCheckbox = document.getElementById('format-punctuation');
        this.formatNumbersCheckbox = document.getElementById('format-numbers');
        
        // Scroll control elements
        this.scrollUpBtn = document.getElementById('scroll-up-btn');
        this.scrollDownBtn = document.getElementById('scroll-down-btn');
        this.prevParagraphBtn = document.getElementById('prev-paragraph-btn');
        this.nextParagraphBtn = document.getElementById('next-paragraph-btn');
        this.scrollAmountControl = document.getElementById('scroll-amount');
        this.scrollAmountDisplay = document.getElementById('scroll-amount-display');
        this.paragraphSelect = document.getElementById('paragraph-select');
    }
    
    bindEvents() {
        this.fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        this.clearBtn.addEventListener('click', () => this.clearText());
        this.speedControl.addEventListener('input', (e) => this.updateSpeed(e.target.value));
        this.segmentMinutesInput.addEventListener('input', () => this.updateSegmentLength());
        this.segmentSecondsInput.addEventListener('input', () => this.updateSegmentLength());
        this.fontSizeControl.addEventListener('input', (e) => this.updateFontSize(e.target.value));
        this.mirrorModeCheckbox.addEventListener('change', (e) => this.updateMirrorMode(e.target.checked));
        this.hideTimerCheckbox.addEventListener('change', (e) => this.updateHideTimer(e.target.checked));
        this.onAirModeCheckbox.addEventListener('change', (e) => this.updateOnAir(e.target.checked));
        this.scheduledStartInput.addEventListener('change', () => this.updateScheduledStart());
        this.clearScheduleBtn.addEventListener('click', () => this.clearScheduledStart());
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.copyUrlBtn.addEventListener('click', () => this.copyDisplayUrl());
        this.formatBtn.addEventListener('click', () => this.formatTextForTeleprompter());
        
        // Scroll control events
        this.scrollUpBtn.addEventListener('click', () => this.scrollUp());
        this.scrollDownBtn.addEventListener('click', () => this.scrollDown());
        this.prevParagraphBtn.addEventListener('click', () => this.prevParagraph());
        this.nextParagraphBtn.addEventListener('click', () => this.nextParagraph());
        this.scrollAmountControl.addEventListener('input', (e) => this.updateScrollAmount(e.target.value));
        this.paragraphSelect.addEventListener('change', (e) => this.goToParagraph(e.target.value));
        
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
        
        this.formattingOptions.style.display = 'block';
        
        // Text preview updates - debounced
        let textUpdateTimeout = null;
        this.textPreview.addEventListener('input', () => {
            this.updateDurationCalculations();
            this.updateParagraphSelect();
            if (textUpdateTimeout) clearTimeout(textUpdateTimeout);
            textUpdateTimeout = setTimeout(() => { this.sendTextUpdate(); }, 300);
        });
        
        this.textPreview.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.start(); }
        });
    }
    
    // Scroll Control Methods
    scrollUp() { this.sendMessage({ type: 'scrollUp', pixels: this.scrollAmount }); }
    scrollDown() { this.sendMessage({ type: 'scrollDown', pixels: this.scrollAmount }); }
    prevParagraph() { this.sendMessage({ type: 'prevParagraph' }); }
    nextParagraph() { this.sendMessage({ type: 'nextParagraph' }); }
    goToParagraph(index) { if (index !== '' && index !== null) { this.sendMessage({ type: 'goToParagraph', index: parseInt(index) }); } }
    updateScrollAmount(value) { this.scrollAmount = parseInt(value); this.scrollAmountDisplay.textContent = this.scrollAmount + 'px'; }
    
    updateParagraphSelect() {
        const paragraphs = this.textPreview.querySelectorAll('p');
        this.paragraphSelect.innerHTML = '<option value="">-- Select Paragraph --</option>';
        paragraphs.forEach((p, index) => {
            const option = document.createElement('option');
            option.value = index;
            const text = p.textContent || p.innerText || '';
            option.textContent = `${index + 1}. ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`;
            this.paragraphSelect.appendChild(option);
        });
    }
    
    handleKeyboardShortcuts(e) {
        const activeElement = document.activeElement;
        const isEditing = activeElement.tagName === 'INPUT' || 
                          activeElement.tagName === 'TEXTAREA' || 
                          activeElement.tagName === 'SELECT' ||
                          activeElement.isContentEditable;
        
        // When editing, don't intercept any keys - let them work normally
        if (isEditing) {
            return;
        }
        
        // Bluetooth controller / keyboard shortcuts (only when NOT editing)
        if (e.key === 'ArrowUp') { e.preventDefault(); this.scrollUp(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.scrollDown(); return; }
        // if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevParagraph(); return; }
        // if (e.key === 'ArrowRight') { e.preventDefault(); this.nextParagraph(); return; }
        if (e.key === 'Enter') { e.preventDefault(); this.isPlaying ? this.pause() : this.start(); return; }
        if (e.key === ' ') { e.preventDefault(); this.isPlaying ? this.pause() : this.start(); return; }
        if (e.key === 'PageUp') { e.preventDefault(); this.prevParagraph(); return; }
        if (e.key === 'PageDown') { e.preventDefault(); this.nextParagraph(); return; }
        if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); this.sendMessage({ type: 'setScrollPosition', position: 0 }); return; }
    }
    
    // WebSocket Connection
    connectWebSocket() {
        try {
            this.updateConnectionStatus('connecting', 'Connecting...');
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
            this.ws = new WebSocket(`${wsProtocol}//${window.location.hostname}:${wsPort}`);
            
            this.ws.onopen = () => {
                console.log('Connected to WebSocket server');
                this.updateConnectionStatus('connected', 'Connected');
                this.reconnectAttempts = 0;
                this.ws.send(JSON.stringify({ type: 'register', role: 'controller' }));
            };
            
            this.ws.onmessage = (event) => {
                try { this.handleMessage(JSON.parse(event.data)); }
                catch (error) { console.error('Error parsing message:', error); }
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket connection closed');
                this.updateConnectionStatus('disconnected', 'Disconnected');
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('disconnected', 'Connection Error');
            };
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.updateConnectionStatus('disconnected', 'Failed to Connect');
            this.scheduleReconnect();
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            this.updateConnectionStatus('connecting', `Reconnecting in ${Math.ceil(delay / 1000)}s...`);
            setTimeout(() => { this.connectWebSocket(); }, delay);
        } else {
            this.updateConnectionStatus('disconnected', 'Max reconnect attempts reached');
        }
    }
    
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    
    // Message Handling - Receive updates from server
    handleMessage(data) {
        switch (data.type) {
            case 'stateSync': this.syncStateFromServer(data.state); break;
            case 'pong': break;
            case 'connectionCount': this.updateConnectionInfo(data); break;
            case 'setText': this.receiveTextUpdate(data.content); break;
            case 'setSpeed': this.receiveSpeedUpdate(data.value); break;
            case 'setFontSize': this.receiveFontSizeUpdate(data.value); break;
            case 'setSegmentLength': this.receiveSegmentLengthUpdate(data); break;
            case 'setMirrorMode': this.receiveMirrorModeUpdate(data.enabled); break;
            case 'setHideTimer': this.receiveHideTimerUpdate(data.enabled); break;
            case 'setOnAir': this.receiveOnAirUpdate(data.enabled); break;
            case 'setScheduledStart': this.receiveScheduledStartUpdate(data.scheduledTime); break;
            case 'clearScheduledStart': this.receiveClearScheduledStart(); break;
            case 'start': this.receiveStart(data.startTime, data.pausedTime); break;
            case 'pause': this.receivePause(data.pausedTime); break;
            case 'reset': this.receiveReset(); break;
            default: console.log('Unknown message type:', data.type);
        }
    }
    
    // Sync State From Server
    syncStateFromServer(state) {
        if (!state) return;
        console.log('Syncing state from server:', state);
        this.isReceivingUpdate = true;
        
        if (state.text) { this.textPreview.innerHTML = state.text; this.updateParagraphSelect(); }
        
        this.speed = state.speed || 150;
        this.speedControl.value = this.speed;
        this.speedDisplay.textContent = this.speed;
        
        this.fontSize = state.fontSize || 48;
        this.fontSizeControl.value = this.fontSize;
        this.fontSizeDisplay.textContent = this.fontSize + 'px';
        
        const segmentLength = state.segmentLength || 600;
        const minutes = state.segmentMinutes || Math.floor(segmentLength / 60);
        const seconds = state.segmentSeconds || (segmentLength % 60);
        this.segmentMinutesInput.value = minutes;
        this.segmentSecondsInput.value = seconds;
        this.segmentDuration = segmentLength * 1000;
        
        this.mirrorModeCheckbox.checked = state.mirrorMode || false;
        this.hideTimerCheckbox.checked = state.hideTimer || false;
        this.onAirModeCheckbox.checked = state.onAir || false;
        
        if (state.scheduledStartTime) {
            const date = new Date(state.scheduledStartTime);
            const localDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
            this.scheduledStartInput.value = localDateTime;
            this.scheduleInfo.innerHTML = `<span>Scheduled for: ${date.toLocaleString()}</span>`;
        } else {
            this.scheduledStartInput.value = '';
            this.scheduleInfo.innerHTML = '<span>No scheduled start time set</span>';
        }
        
        this.isPlaying = state.isPlaying || false;
        this.isPaused = state.isPaused || false;
        this.startTime = state.startTime || null;
        this.pausedTime = state.pausedTime || 0;
        
        if (this.isPlaying) { this.startBtn.disabled = true; this.pauseBtn.disabled = false; this.startTimer(); }
        else if (this.isPaused) { this.startBtn.disabled = false; this.pauseBtn.disabled = true; }
        else { this.startBtn.disabled = false; this.pauseBtn.disabled = true; }
        
        this.updateDurationCalculations();
        this.updateDisplay();
        this.updateCountdownDisplay();
        this.isReceivingUpdate = false;
    }
    
    // Receive Individual Updates
    receiveTextUpdate(content) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.textPreview.innerHTML = content; this.updateParagraphSelect(); this.updateDurationCalculations(); this.isReceivingUpdate = false; }
    receiveSpeedUpdate(value) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.speed = value; this.speedControl.value = value; this.speedDisplay.textContent = value; this.updateDurationCalculations(); this.isReceivingUpdate = false; }
    receiveFontSizeUpdate(value) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.fontSize = value; this.fontSizeControl.value = value; this.fontSizeDisplay.textContent = value + 'px'; this.isReceivingUpdate = false; }
    receiveSegmentLengthUpdate(data) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; const m = data.minutes || Math.floor((data.totalSeconds || 600) / 60); const s = data.seconds || ((data.totalSeconds || 600) % 60); this.segmentMinutesInput.value = m; this.segmentSecondsInput.value = s; this.segmentDuration = (data.totalSeconds || 600) * 1000; this.updateDurationCalculations(); this.updateCountdownDisplay(); this.isReceivingUpdate = false; }
    receiveMirrorModeUpdate(enabled) { if (this.isReceivingUpdate) return; this.mirrorModeCheckbox.checked = enabled; }
    receiveHideTimerUpdate(enabled) { if (this.isReceivingUpdate) return; this.hideTimerCheckbox.checked = enabled; }
    receiveOnAirUpdate(enabled) { if (this.isReceivingUpdate) return; this.onAirModeCheckbox.checked = enabled; }
    receiveScheduledStartUpdate(scheduledTime) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; const date = new Date(scheduledTime); const localDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); this.scheduledStartInput.value = localDateTime; this.scheduleInfo.innerHTML = `<span>Scheduled for: ${date.toLocaleString()}</span>`; this.isReceivingUpdate = false; }
    receiveClearScheduledStart() { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.scheduledStartInput.value = ''; this.scheduleInfo.innerHTML = '<span>No scheduled start time set</span>'; this.isReceivingUpdate = false; }
    receiveStart(startTime, pausedTime) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.isPlaying = true; this.isPaused = false; this.startTime = startTime || Date.now(); this.pausedTime = pausedTime || 0; this.onAirModeCheckbox.checked = true; this.startBtn.disabled = true; this.pauseBtn.disabled = false; this.startTimer(); this.isReceivingUpdate = false; }
    receivePause(pausedTime) { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.isPlaying = false; this.isPaused = true; this.pausedTime = pausedTime || 0; this.startBtn.disabled = false; this.pauseBtn.disabled = true; this.stopTimer(); this.isReceivingUpdate = false; }
    receiveReset() { if (this.isReceivingUpdate) return; this.isReceivingUpdate = true; this.isPlaying = false; this.isPaused = false; this.currentPosition = 0; this.startTime = null; this.pausedTime = 0; this.startBtn.disabled = false; this.pauseBtn.disabled = true; this.stopTimer(); this.updateDisplay(); this.isReceivingUpdate = false; }
    updateConnectionInfo(data) { this.updateConnectionStatus('connected', `Connected (${data.controllers} ctrl, ${data.displays} disp)`); }
    
    // File Handling
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            let text = '';
            if (file.type === 'text/plain') { text = await this.readTextFile(file); }
            else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.toLowerCase().endsWith('.docx')) { text = await this.readWordDocument(file); }
            else if (file.type.includes('word') || file.name.toLowerCase().endsWith('.doc')) { alert('Legacy .doc files are not supported.'); return; }
            else { text = await this.readTextFile(file); }
            this.setPrompterText(text);
        } catch (error) { alert('Error reading file: ' + error.message); }
    }
    
    readTextFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.onerror = () => reject(new Error('Failed to read file')); reader.readAsText(file); }); }
    readWordDocument(file) { return new Promise((resolve, reject) => { if (typeof mammoth === 'undefined') { reject(new Error('Mammoth library not loaded.')); return; } const reader = new FileReader(); reader.onload = async (e) => { try { const result = await mammoth.extractRawText({arrayBuffer: e.target.result}); resolve(result.value); } catch (error) { reject(new Error('Failed to parse Word document: ' + error.message)); } }; reader.onerror = () => reject(new Error('Failed to read Word document')); reader.readAsArrayBuffer(file); }); }
    
    setPrompterText(text) {
        if (this.autoFormatCheckbox.checked) { text = this.formatTextForTeleprompterStandards(text); }
        const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
        this.textPreview.innerHTML = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
        this.sendTextUpdate();
        this.updateDurationCalculations();
        this.updateParagraphSelect();
    }
    
    sendTextUpdate() { if (this.isReceivingUpdate) return; this.sendMessage({ type: 'setText', content: this.textPreview.innerHTML }); }
    clearText() { this.textPreview.innerHTML = '<p>Upload your manuscript or type your text here...</p>'; this.sendTextUpdate(); this.reset(); this.updateDurationCalculations(); this.updateParagraphSelect(); }
    
    // Settings Updates
    updateSpeed(value) { if (this.isReceivingUpdate) return; this.speed = parseInt(value); this.speedDisplay.textContent = this.speed; this.sendMessage({ type: 'setSpeed', value: this.speed }); this.updateDurationCalculations(); }
    updateSegmentLength() { if (this.isReceivingUpdate) return; const m = parseInt(this.segmentMinutesInput.value) || 0; const s = parseInt(this.segmentSecondsInput.value) || 0; this.segmentDuration = (m * 60 + s) * 1000; this.sendMessage({ type: 'setSegmentLength', minutes: m, seconds: s, totalSeconds: m * 60 + s }); this.updateDurationCalculations(); this.updateCountdownDisplay(); }
    updateFontSize(value) { if (this.isReceivingUpdate) return; this.fontSize = parseInt(value); this.fontSizeDisplay.textContent = this.fontSize + 'px'; this.sendMessage({ type: 'setFontSize', value: this.fontSize }); }
    updateMirrorMode(enabled) { if (this.isReceivingUpdate) return; this.sendMessage({ type: 'setMirrorMode', enabled }); }
    updateHideTimer(enabled) { if (this.isReceivingUpdate) return; this.sendMessage({ type: 'setHideTimer', enabled }); }
    updateOnAir(enabled) { if (this.isReceivingUpdate) return; this.sendMessage({ type: 'setOnAir', enabled }); }
    
    updateScheduledStart() {
        if (this.isReceivingUpdate) return;
        const scheduledTime = this.scheduledStartInput.value;
        if (scheduledTime) {
            const scheduledDate = new Date(scheduledTime);
            if (scheduledDate <= new Date()) { alert('Scheduled time must be in the future'); this.scheduledStartInput.value = ''; return; }
            this.scheduleInfo.innerHTML = `<span>Scheduled for: ${scheduledDate.toLocaleString()}</span>`;
            this.sendMessage({ type: 'setScheduledStart', scheduledTime: scheduledDate.getTime() });
        } else { this.clearScheduledStart(); }
    }
    
    clearScheduledStart() { if (this.isReceivingUpdate) return; this.scheduledStartInput.value = ''; this.scheduleInfo.innerHTML = '<span>No scheduled start time set</span>'; this.sendMessage({ type: 'clearScheduledStart' }); }
    
    // Playback Controls
    start() { if (this.isReceivingUpdate) return; if (this.isPaused) { this.resume(); return; } this.isPlaying = true; this.isPaused = false; this.startTime = Date.now() - (this.pausedTime || 0); this.onAirModeCheckbox.checked = true; this.startBtn.disabled = true; this.pauseBtn.disabled = false; this.sendMessage({ type: 'start' }); this.startTimer(); }
    pause() { if (this.isReceivingUpdate) return; this.isPaused = true; this.isPlaying = false; this.pausedTime = Date.now() - this.startTime; this.startBtn.disabled = false; this.pauseBtn.disabled = true; this.sendMessage({ type: 'pause' }); this.stopTimer(); }
    resume() { this.isPlaying = true; this.isPaused = false; this.startTime = Date.now() - this.pausedTime; this.startBtn.disabled = true; this.pauseBtn.disabled = false; this.sendMessage({ type: 'start' }); this.startTimer(); }
    reset() { if (this.isReceivingUpdate) return; this.isPlaying = false; this.isPaused = false; this.currentPosition = 0; this.startTime = null; this.pausedTime = 0; this.startBtn.disabled = false; this.pauseBtn.disabled = true; this.sendMessage({ type: 'reset' }); this.stopTimer(); this.updateDisplay(); }
    
    startTimer() { this.stopTimer(); this.timerInterval = setInterval(() => { this.updateDisplay(); }, 1000); }
    stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }
    
    updateDisplay() {
        const elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime;
        const remaining = Math.max(0, this.segmentDuration - elapsed);
        this.updateCountdownDisplay(remaining);
        this.updateElapsedDisplay(elapsed);
        if (remaining <= 0 && this.isPlaying) { this.pause(); alert('Segment time completed!'); }
    }
    
    updateCountdownDisplay(remaining = this.segmentDuration) { const m = Math.floor(remaining / 60000); const s = Math.floor((remaining % 60000) / 1000); this.segmentTimer.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; }
    updateElapsedDisplay(elapsed) { const m = Math.floor(elapsed / 60000); const s = Math.floor((elapsed % 60000) / 1000); this.elapsedTimer.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; }
    
    // Duration Calculations
    updateDurationCalculations() {
        const wordCount = this.getWordCount();
        const expectedDurationMs = this.calculateExpectedDuration(wordCount);
        this.wordCount.textContent = wordCount.toLocaleString();
        this.expectedDuration.textContent = this.formatDuration(expectedDurationMs);
        const differenceMs = this.segmentDuration - expectedDurationMs;
        this.diffValue.textContent = this.formatDurationDiff(differenceMs);
        this.durationDiff.classList.remove('positive', 'negative', 'neutral');
        if (Math.abs(differenceMs) < 30000) this.durationDiff.classList.add('neutral');
        else if (differenceMs > 0) this.durationDiff.classList.add('positive');
        else this.durationDiff.classList.add('negative');
    }
    
    getWordCount() { const text = this.textPreview.textContent || this.textPreview.innerText || ''; return text.trim().split(/\s+/).filter(w => w.length > 0).length; }
    calculateExpectedDuration(wordCount) { return Math.round((wordCount / this.speed) * 60 * 1000); }
    formatDuration(ms) { const totalSec = Math.floor(ms / 1000); const m = Math.floor(totalSec / 60); const s = totalSec % 60; return `${m}:${s.toString().padStart(2, '0')}`; }
    formatDurationDiff(ms) { const isNeg = ms < 0; const abs = Math.abs(ms); const totalSec = Math.floor(abs / 1000); const m = Math.floor(totalSec / 60); const s = totalSec % 60; return `${isNeg ? '-' : '+'}${m}:${s.toString().padStart(2, '0')}`; }
    
    // UI Updates
    updateConnectionStatus(status, text) { this.statusIndicator.className = `status-indicator ${status}`; this.statusText.textContent = text; }
    updateDisplayUrl() { const p = window.location.protocol; const h = window.location.hostname; const port = window.location.port ? `:${window.location.port}` : ''; this.displayUrl.textContent = `${p}//${h}${port}/display.html`; }
    
    copyDisplayUrl() {
        const p = window.location.protocol; const h = window.location.hostname; const port = window.location.port ? `:${window.location.port}` : '';
        const displayUrl = `${p}//${h}${port}/display.html`;
        navigator.clipboard.writeText(displayUrl).then(() => { this.copyUrlBtn.textContent = 'Copied!'; setTimeout(() => { this.copyUrlBtn.textContent = 'Copy'; }, 2000); }).catch(() => { const ta = document.createElement('textarea'); ta.value = displayUrl; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); this.copyUrlBtn.textContent = 'Copied!'; setTimeout(() => { this.copyUrlBtn.textContent = 'Copy'; }, 2000); });
    }
    
    // Text Formatting
    formatTextForTeleprompter() { const t = this.textPreview.textContent || this.textPreview.innerText || ''; if (!t.trim()) { alert('No text to format.'); return; } this.setPrompterTextDirectly(this.formatTextForTeleprompterStandards(t)); }
    setPrompterTextDirectly(text) { const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0); this.textPreview.innerHTML = paragraphs.map(p => `<p>${p.trim()}</p>`).join(''); this.sendTextUpdate(); this.updateDurationCalculations(); this.updateParagraphSelect(); }
    
    formatTextForTeleprompterStandards(text) {
        let f = text;
        if (this.formatCapsCheckbox.checked) f = f.toUpperCase();
        if (this.formatNumbersCheckbox.checked) f = this.convertNumbersToWords(f);
        if (this.formatPunctuationCheckbox.checked) f = f.replace(/\./g, '. ').replace(/,/g, ', ').replace(/;/g, '; ').replace(/:/g, ': ').replace(/\?/g, '? ').replace(/!/g, '! ').replace(/\s+/g, ' ').trim();
        if (this.formatSentencesCheckbox.checked) f = f.replace(/([.!?])\s+/g, '$1\n\n').replace(/\n\n+/g, '\n\n').trim();
        if (this.formatParagraphsCheckbox.checked) { const sentences = f.split(/\n\n/); const grouped = []; for (let i = 0; i < sentences.length; i += 3) grouped.push(sentences.slice(i, i + 3).join('\n\n')); f = grouped.join('\n\n\n'); }
        return f;
    }
    
    convertNumbersToWords(text) {
        const nw = {'0':'ZERO','1':'ONE','2':'TWO','3':'THREE','4':'FOUR','5':'FIVE','6':'SIX','7':'SEVEN','8':'EIGHT','9':'NINE','10':'TEN','11':'ELEVEN','12':'TWELVE','13':'THIRTEEN','14':'FOURTEEN','15':'FIFTEEN','16':'SIXTEEN','17':'SEVENTEEN','18':'EIGHTEEN','19':'NINETEEN','20':'TWENTY','30':'THIRTY','40':'FORTY','50':'FIFTY','60':'SIXTY','70':'SEVENTY','80':'EIGHTY','90':'NINETY','100':'ONE HUNDRED'};
        return text.replace(/\b(\d{1,3})\b/g, (match, number) => { const n = parseInt(number); if (nw[n]) return nw[n]; if (n < 100) { const tens = Math.floor(n / 10) * 10; const ones = n % 10; if (tens > 0 && ones > 0) return `${nw[tens]}-${nw[ones]}`; } return match; });
    }
}

document.addEventListener('DOMContentLoaded', () => { new TeleprompterController(); });