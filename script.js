// Import prompts from the separate file (if still needed for single-player)
import {geemsPrompts} from './prompts.js';
import MPLib from './mp.js';
// Assuming MPLib is globally available after including mp.js or imported if using modules
// import MPLib from './mp.js'; // Uncomment if using ES6 modules for MPLib

// --- Game State Variables ---
let hasPrimaryApiKeyFailed = false;
let historyQueue = [];
const MAX_HISTORY_SIZE = 10; // Keep track of the last 10 game turns
let currentUiJson = null;
let currentNotes = {};
let currentSubjectId = "";
let isExplicitMode = false; // Default mode
let isLoading = false;
let apiKeyLocked = false;
let localGameStateSnapshot = null; // To store local state when viewing remote state
let llmCallHistory = []; // For the debug panel

// --- Model Switching State ---
const AVAILABLE_MODELS = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",

];
let currentModelIndex = 0;

// --- Configuration ---
const MIN_CONTRAST_LIGHTNESS = 0.55;
const LOCAL_STORAGE_KEY = 'geemsGameStateToRestore';
// --- DOM Element References ---
const lobbyContainer = document.getElementById('lobby-container');
const gameWrapper = document.getElementById('game-wrapper');
const proposalModal = document.getElementById('proposalModal');
const proposalModalTitle = document.getElementById('proposalModalTitle');
const proposalModalBody = document.getElementById('proposalModalBody');
const proposerName = document.getElementById('proposerName');
const proposalAcceptButton = document.getElementById('proposalAcceptButton');
const proposalDeclineButton = document.getElementById('proposalDeclineButton');
const interstitialMessage = document.getElementById('interstitial-message');
const uiContainer = document.getElementById('ui-elements');
const loadingIndicator = document.getElementById('loading');
const interstitialScreen = document.getElementById('interstitial-screen');
const interstitialSpinner = document.getElementById('interstitial-spinner');
const interstitialReports = document.getElementById('interstitial-reports');
const greenFlagReport = document.getElementById('green-flag-report');
const redFlagReport = document.getElementById('red-flag-report');
const interstitialContinueButton = document.getElementById('interstitial-continue-button');
const submitButton = document.getElementById('submit-turn');
const apiKeyInput = document.getElementById('apiKeyInput');
const errorDisplay = document.getElementById('error-display');
const modeToggleButton = document.getElementById('modeToggleButton');
const resetGameButton = document.getElementById('resetGameButton');
const clipboardMessage = document.getElementById('clipboardMessage');
// Assume footer exists, get reference to it
const footerElement = document.querySelector('.site-footer');
const h1 = document.querySelector('h1');
let peerListContainer = null; // Will be created dynamically

// --- Debug Panel Elements ---
const debugPanel = document.getElementById('debug-panel');
const toggleDebugPanelButton = document.getElementById('toggle-debug-panel');
const debugPanelCloseButton = document.getElementById('debug-panel-close-btn');
const debugLogsContainer = document.getElementById('debug-panel-logs');

// --- Web Audio API Context ---
let audioCtx = null;

// --- Multiplayer State ---
let isDateActive = false;
let currentPartnerId = null;
let amIPlayer1 = false;
let turnSubmissions = new Map(); // New state for turn aggregation
let incomingProposal = null;
let isDateExplicit = false;
let globalRoomDirectory = { rooms: {}, peers: {} }; // Holds the global state
let currentRoomName = null; // The name of the room the user is currently in
let currentRoomIsPublic = true; // Whether the current room is public or private

const remoteGameStates = new Map(); // Map<peerId, gameState>
const LOCAL_PROFILE_KEY = 'sparksync_userProfile';

// --- Long Press State ---
let pressTimer = null;
let isLongPress = false;
const longPressDuration = 750; // milliseconds

// --- Helper Functions ---

/** Returns the primary API key if it hasn't failed. */
function getPrimaryApiKey() {
    if (hasPrimaryApiKeyFailed) {
        return null;
    }
    // The primary, embedded API key.
    return 'AIzaSyA-jfxiOqRoWOXEjTmT9zMpc4M6nen6k10';
}

/** Encodes a string using Base64. */
function encodeApiKey(key) {
    try {
        return btoa(key);
    } catch (e) {
        console.error("Error encoding API key:", e);
        return "";
    }
}

/** Decodes a Base64 string. Returns null on error. */
function decodeApiKey(encodedKey) {
    try {
        return atob(encodedKey);
    } catch (e) {
        console.error("Error decoding API key:", e);
        return null;
    }
}
/** Constructs the full prompt for the Gemini API call based on the prompt type. */
function constructPrompt(promptType, turnData) {
    const {
        playerA_actions,
        playerB_actions,
        playerA_notes,
        playerB_notes,
        isExplicit = false,
        isFirstTurn = false, // Extract the new flag
        history = []
    } = turnData;

    const activeAddendum = isExplicit ? `\n\n---\n${geemsPrompts.masturbationModeAddendum}\n---\n` : "";
    let prompt;

    switch (promptType) {
        case 'orchestrator':
            prompt = geemsPrompts.orchestrator;
            // Append the first run addendum if it's the first turn.
            if (isFirstTurn) {
                prompt += geemsPrompts.firstrun_addendum;
            }

            // Add history section if it exists
            if (history && history.length > 0) {
                const historyString = history.map((turn, index) =>
                    `Turn ${history.length - index} ago:\n- UI displayed to player:\n${turn.ui}\n- Player actions taken:\n${turn.actions}`
                ).join('\n\n');
                prompt += `\n\n---\nCONTEXT: LAST ${history.length} TURNS (Most recent first)\n---\n${historyString}`;
            }

            prompt += `\n\n---\nLATEST TURN DATA\n---\n`;
            prompt += `player_input_A: ${JSON.stringify(playerA_actions)}\n`;
            prompt += `previous_notes_A: \`\`\`markdown\n${playerA_notes}\n\`\`\`\n\n`;
            prompt += `player_input_B: ${JSON.stringify(playerB_actions)}\n`;
            prompt += `previous_notes_B: \`\`\`markdown\n${playerB_notes}\n\`\`\`\n`;
            prompt += activeAddendum;
            prompt += `\n--- Generate instructions for both players based on the above. ---`;
            if(isFirstTurn) console.log("Generated First Turn Orchestrator Prompt.");
            else console.log("Generated Orchestrator Prompt.");
            break;

        // The 'main' prompt is now called directly, so no case is needed here.

        default:
            throw new Error(`Unknown prompt type: ${promptType}`);
    }

    return prompt;
}

/** Saves the current essential game state to local storage. */
function autoSaveGameState() {
    if (!apiKeyLocked) return;
    if (!currentUiJson || !historyQueue) return;
    const rawApiKey = apiKeyInput.value.trim();
    if (!rawApiKey) return;
    try {
        const stateToSave = {
            encodedApiKey: encodeApiKey(rawApiKey),
            currentUiJson: currentUiJson,
            historyQueue: historyQueue,
            isExplicitMode: isExplicitMode,
            currentModelIndex: currentModelIndex
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        console.log("Game state auto-saved.");
    } catch (error) {
        console.error("Error during auto-save:", error);
        showError("Error auto-saving game state.");
    }
}

/**
 * Retrieves the local user's profile from localStorage.
 * @returns {object} The user profile object or a default object.
 */
function getLocalProfile() {
    try {
        const profileJson = localStorage.getItem(LOCAL_PROFILE_KEY);
        return profileJson ? JSON.parse(profileJson) : {
            name: "Anonymous",
            gender: "Unknown",
            physical: {}, // For attributes like hair, eyes, etc.
            personality: {} // For Dr. Gemini's notes
        };
    } catch (e) {
        console.error("Error reading local profile:", e);
        return { name: "Anonymous", gender: "Unknown", physical: {}, personality: {} };
    }
}

/**
 * Extracts profile information from a turn's actions and saves it.
 * @param {object} actions - The JSON object of actions from the turn.
 */
function updateLocalProfileFromTurn(actions) {
    if (!actions) return;

    const profile = getLocalProfile();
    let updated = false;

    // Define keys that represent profile data
    const profileKeys = {
        'player_name': 'name',
        'player_gender': 'gender'
        // Physical attributes will be handled separately
    };

    // Update top-level profile fields
    for (const key in actions) {
        if (profileKeys[key]) {
            const profileField = profileKeys[key];
            if (profile[profileField] !== actions[key]) {
                profile[profileField] = actions[key];
                updated = true;
                console.log(`Updated profile ${profileField} to: ${actions[key]}`);
            }
        }
    }

    // Specifically handle physical attributes which might be nested or varied
    const physicalKeys = ['hair_style', 'eye_color', 'build', 'clothing_style', 'distinguishing_feature'];
    for(const key of physicalKeys) {
        if(actions[key] && profile.physical[key] !== actions[key]) {
             profile.physical[key] = actions[key];
             updated = true;
             console.log(`Updated physical profile ${key} to: ${actions[key]}`);
        }
    }

    // Extract the detailed psychological profile from the 'notes' field
    if (actions.notes) {
        if (profile.personality.notes !== actions.notes) {
            profile.personality.notes = actions.notes;
            updated = true;
            console.log("Updated personality notes.");
        }
    }

    if (updated) {
        try {
            localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
            console.log("Local user profile saved.", profile);

            // Broadcast the updated profile to all peers in the room.
            MPLib.broadcastToRoom({
                type: 'profile_update',
                payload: profile
            });

            // If we are in the lobby, re-render to show our own profile update
            if (lobbyContainer.style.display === 'block') {
                renderLobby();
            }
        } catch (e) {
            console.error("Error saving or broadcasting local profile:", e);
        }
    }
}

/**
 * Generates a descriptive prompt for an image generator based on a player's profile.
 * @param {object} profile - The player's profile object.
 * @returns {string} A prompt for Pollinations.ai.
 */
function generateAvatarPrompt(profile) {
    if (!profile || !profile.physical) {
        // A more interesting default if no data exists
        return "a shadowy figure in a dimly lit room, mysterious, noir";
    }

    const { physical, gender, name } = profile;
    // Base prompt with style
    let promptParts = ["a detailed anime character portrait of a"];

    // Core description
    let description = [];
    if (gender && gender.toLowerCase() !== 'unknown') {
        description.push(gender);
    } else {
        description.push("person");
    }

    if (physical.distinguishing_feature) {
        description.push(`with a ${physical.distinguishing_feature}`);
    }
    if (physical.build) {
        description.push(`who has a ${physical.build} build`);
    }

    promptParts.push(description.join(' '));

    // Specific features
    if (physical.hair_style) {
        promptParts.push(`${physical.hair_style} hair`);
    }
    if (physical.eye_color) {
        promptParts.push(`${physical.eye_color} eyes`);
    }
    if (physical.clothing_style) {
        promptParts.push(`wearing ${physical.clothing_style}`);
    }

    // Add some style keywords for a better look
    promptParts.push("studio lighting, vibrant colors, detailed face, cinematic");

    return promptParts.join(', ');
}


/** Initializes the AudioContext if it doesn't exist. */
function initAudioContext() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            console.log("AudioContext initialized.");
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) {
            console.error("Web Audio API not supported.", e);
            showError("Audio alerts not supported.");
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(err => console.error("Error resuming audio context:", err));
}

/** Plays the turn alert sound. */
function playTurnAlertSound() {
    initAudioContext();
    if (!audioCtx || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime, totalDuration = 1.0;
    const fogOsc = audioCtx.createOscillator(), fogGain = audioCtx.createGain();
    fogOsc.type = 'sawtooth';
    fogOsc.frequency.setValueAtTime(80, now);
    fogGain.gain.setValueAtTime(0.3, now);
    fogGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    fogOsc.connect(fogGain);
    fogGain.connect(audioCtx.destination);
    fogOsc.start(now);
    fogOsc.stop(now + 0.5);
    const beepOsc = audioCtx.createOscillator(), beepGain = audioCtx.createGain();
    beepOsc.type = 'square';
    beepOsc.frequency.setValueAtTime(440, now + 0.6);
    beepGain.gain.setValueAtTime(0, now + 0.6);
    beepGain.gain.linearRampToValueAtTime(0.2, now + 0.65);
    beepGain.gain.setValueAtTime(0.2, now + 0.75);
    beepGain.gain.linearRampToValueAtTime(0, now + 0.8);
    beepOsc.frequency.setValueAtTime(523, now + 0.85);
    beepGain.gain.setValueAtTime(0, now + 0.85);
    beepGain.gain.linearRampToValueAtTime(0.2, now + 0.9);
    beepGain.gain.setValueAtTime(0.2, now + totalDuration - 0.05);
    beepGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);
    beepOsc.connect(beepGain);
    beepGain.connect(audioCtx.destination);
    beepOsc.start(now + 0.6);
    beepOsc.stop(now + totalDuration);
    console.log("Playing turn alert sound.");
}

/** Updates the history queue. */
function updateHistoryQueue(playerActionsJson) {
    if (currentUiJson) {
        const previousTurnData = {ui: JSON.stringify(currentUiJson), actions: playerActionsJson || "{}"};
        const isDuplicate = historyQueue.some(item => JSON.stringify(item) === JSON.stringify(previousTurnData));
        if (isDuplicate) {
            console.log("Duplicate turn data detected, not adding to history queue.");
            return;
        }
        if (historyQueue.length >= MAX_HISTORY_SIZE) historyQueue.shift();
        historyQueue.push(previousTurnData);
        console.log(`History Queue size: ${historyQueue.length}/${MAX_HISTORY_SIZE}`);
    }
}

/** Gets the current game state for sending to peers. */
function getCurrentGameState() {
    // Basic example: Send current UI JSON and history.
    // Adapt this to include *actual* relevant game variables.
    return {
        currentUiJson: currentUiJson,
        historyQueue: historyQueue,
        currentSubjectId: currentSubjectId,
        // Add other critical state variables here, e.g., player inventory, world state etc.
        // currentNotes: currentNotes // Maybe too large? Decide what's needed.
    };
}

/** Loads a game state received from a peer. */
function loadGameState(newState, sourcePeerId = null) {
    if (!newState) {
        console.error("Attempted to load null game state.");
        return;
    }
    console.log(`Loading game state${sourcePeerId ? ` from peer ${sourcePeerId.slice(-6)}` : ''}`);

    // Before loading remote state, save the current local state
    saveLocalState();

    // Basic example: Restore UI and history.
    // Adapt this to handle your game's specific state restoration.
    currentUiJson = newState.currentUiJson || null;
    historyQueue = newState.historyQueue || [];
    currentSubjectId = newState.currentSubjectId || "Peer"; // Maybe use peer's subject ID?

    // Render the loaded UI
    if (currentUiJson) {
        renderUI(currentUiJson);
        console.log("Loaded game state UI rendered.");
        // Disable submit turn button when viewing remote state?
        submitButton.disabled = false; // Disable submit when viewing remote state
        showNotification(`Viewing ${sourcePeerId ? sourcePeerId.slice(-6) : 'remote'} state. Click your icon to return.`, 'info', 5000);
    } else {
        showError("Loaded game state is missing UI data.");
    }
    updatePeerListUI(); // Highlight the peer being viewed
    highlightPeerIcon(sourcePeerId); // Explicitly highlight
}

/** Saves the current local game state snapshot. */
function saveLocalState() {
    console.log("Saving local game state snapshot.");
    localGameStateSnapshot = {
        currentUiJson: JSON.parse(JSON.stringify(currentUiJson)), // Deep copy
        historyQueue: JSON.parse(JSON.stringify(historyQueue)),   // Deep copy
        currentSubjectId: currentSubjectId
    };
}

/** Restores the previously saved local game state. */
function restoreLocalState() {
    if (localGameStateSnapshot) {
        console.log("Restoring local game state.");
        currentUiJson = localGameStateSnapshot.currentUiJson;
        historyQueue = localGameStateSnapshot.historyQueue;
        currentSubjectId = localGameStateSnapshot.currentSubjectId;
        localGameStateSnapshot = null; // Clear the snapshot

        if (currentUiJson) {
            renderUI(currentUiJson);
            console.log("Restored local game state UI rendered.");
            submitButton.disabled = isLoading || !apiKeyLocked; // Re-enable submit button
            updatePeerListUI(); // Clear highlights
            showNotification("Returned to your game state.", "info", 2000);
        } else {
            showError("Error restoring local game state: UI data missing.");
            // Might need a more robust recovery here
        }
    } else {
        console.warn("No local game state snapshot to restore.");
    }
}


/**
 * Generates the UI for the current player by calling the main UI generator prompt.
 * This is called by both players after receiving the orchestrator's plan.
 * @param {string} orchestratorText - The full plain text output from the orchestrator.
 * @param {string} playerRole - Either 'player1' or 'player2'.
 */
async function generateLocalTurn(orchestratorText, playerRole) {
    console.log(`Generating local turn for ${playerRole}...`);

    // Reset interstitial title for turn generation
    const interstitialTitle = document.querySelector('#interstitial-screen h2');
    if (interstitialTitle) interstitialTitle.textContent = 'Generating Turn...';

    setLoading(true); // Show interstitial

    try {
        const parts = orchestratorText.split('---|||---');
        if (parts.length !== 3) {
            throw new Error("Invalid orchestrator output format. Full text: " + orchestratorText);
        }

        const playerNumber = (playerRole === 'player1') ? 1 : 2;
        const instructions = parts[playerNumber]; // 1 for P1, 2 for P2

        // Combine the master prompt with the turn-specific instructions from the orchestrator.
        const prompt = geemsPrompts.master_ui_prompt + "\n\n" + instructions;
        const uiJsonString = await callGeminiApiWithRetry(prompt);
        let uiJson = JSON.parse(uiJsonString);

        // Defensively handle cases where the AI returns an object instead of an array
        if (!Array.isArray(uiJson) && typeof uiJson === 'object' && uiJson !== null) {
            const arrayKey = Object.keys(uiJson).find(key => Array.isArray(uiJson[key]));
            if (arrayKey) {
                const potentialArray = uiJson[arrayKey];
                console.warn(`API returned an object. Found an array at key: '${arrayKey}'`);

                // Check if the elements in the array are malformed (missing 'type')
                if (potentialArray.length > 0 && potentialArray[0].type === undefined) {
                    console.warn(`Transforming malformed array elements to conform to UI schema.`);
                    uiJson = potentialArray.map(action => ({
                        type: 'radio',
                        name: 'main_action',
                        label: action.label || action.action_id || 'Action', // Use label, fallback to action_id
                        value: action.description || 'No description available.',
                        color: '#FFFFFF' // Default color
                    }));
                } else {
                    uiJson = potentialArray; // The array seems to be in the correct format
                }
            }
        }

        currentUiJson = uiJson;

        // --- Interstitial Logic ---
        if (Array.isArray(uiJson) && isDateActive) { // Only show for dates
            // Find all the report and flag elements
            const pA_green = uiJson.find(el => el.name === 'playerA_green_flags');
            const pA_red = uiJson.find(el => el.name === 'playerA_red_flags');
            const pB_green = uiJson.find(el => el.name === 'playerB_green_flags');
            const pB_red = uiJson.find(el => el.name === 'playerB_red_flags');
            const ownReport = uiJson.find(el => el.name === 'own_clinical_analysis');
            const partnerReport = uiJson.find(el => el.name === 'partner_clinical_analysis');

            // Get player profiles
            const localProfile = getLocalProfile();
            const partnerMasterId = MPLib.getRoomConnections()?.get(currentPartnerId)?.metadata?.masterId;
            const partnerProfile = remoteGameStates.get(partnerMasterId)?.profile || { name: "Partner" };

            // Determine which set of flags/reports belong to local vs partner
            const localIsPlayerA = amIPlayer1;
            const localFlags = {
                green: localIsPlayerA ? pA_green : pB_green,
                red: localIsPlayerA ? pA_red : pB_red,
                report: ownReport
            };
            const partnerFlags = {
                green: localIsPlayerA ? pB_green : pA_green,
                red: localIsPlayerA ? pB_red : pA_red,
                report: partnerReport
            };

            // Get the DOM elements for the new layout
            document.getElementById('local-player-name').textContent = localProfile.name || 'You';
            document.getElementById('partner-player-name').textContent = partnerProfile.name || 'Your Partner';

            // Populate the 'You' column
            document.getElementById('local-green-flags').innerHTML = (localFlags.green && localFlags.green.value) ? localFlags.green.value.replace(/\\n/g, '<br>') : '<em>No specific green flags noted.</em>';
            document.getElementById('local-red-flags').innerHTML = (localFlags.red && localFlags.red.value) ? localFlags.red.value.replace(/\\n/g, '<br>') : '<em>No specific red flags noted.</em>';
            document.getElementById('local-clinical-report').innerHTML = (localFlags.report && localFlags.report.value) ? localFlags.report.value.replace(/\\n/g, '<br>') : '<em>Clinical report not available.</em>';

            // Populate the 'Partner' column
            document.getElementById('partner-green-flags').innerHTML = (partnerFlags.green && partnerFlags.green.value) ? partnerFlags.green.value.replace(/\\n/g, '<br>') : '<em>No specific green flags noted.</em>';
            document.getElementById('partner-red-flags').innerHTML = (partnerFlags.red && partnerFlags.red.value) ? partnerFlags.red.value.replace(/\\n/g, '<br>') : '<em>No specific red flags noted.</em>';
            document.getElementById('partner-clinical-report').innerHTML = (partnerFlags.report && partnerFlags.report.value) ? partnerFlags.report.value.replace(/\\n/g, '<br>') : '<em>Clinical report not available.</em>';

        } else {
            console.warn("API response for UI is not an array or not in a date, skipping interstitial report generation.", uiJson);
            // Clear all reports if the response is invalid
            const reportIds = ['local-green-flags', 'local-red-flags', 'local-clinical-report', 'partner-green-flags', 'partner-red-flags', 'partner-clinical-report'];
            reportIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '<em>Could not parse analysis.</em>';
            });
        }


        interstitialSpinner.style.display = 'none';
        interstitialReports.classList.remove('hidden');
        interstitialContinueButton.disabled = false;
        // --- End Interstitial Logic ---

        renderUI(currentUiJson);
        playTurnAlertSound();

    } catch (error) {
        console.error(`Error during local turn generation for ${playerRole}:`, error);
        showError("Failed to generate your turn. Please try again.");
        interstitialScreen.style.display = 'none';
    } finally {
        setLoading(false);
    }
}



function renderDebugPanel() {
    if (!debugLogsContainer) return;
    debugLogsContainer.innerHTML = ''; // Clear old logs

    if (llmCallHistory.length === 0) {
        debugLogsContainer.innerHTML = '<p class="text-gray-500 p-4">No LLM calls have been made yet.</p>';
        return;
    }

    llmCallHistory.forEach(log => {
        const entry = document.createElement('details');
        entry.className = 'debug-log-entry';

        const summary = document.createElement('summary');
        const title = document.createElement('span');
        // Use toLocaleTimeString for readability
        title.textContent = `[${log.timestamp.toLocaleTimeString()}] ${log.model}`;
        if (log.isError) {
            title.style.color = '#dc3545'; // Red for errors
        }
        const meta = document.createElement('span');
        meta.className = 'log-meta';
        meta.textContent = log.isError ? 'ERROR' : 'OK';
        summary.appendChild(title);
        summary.appendChild(meta);

        const content = document.createElement('div');
        content.className = 'debug-log-content';

        // Use a helper to safely display content
        const escapeHtml = (unsafe) => {
            if (unsafe === null || unsafe === undefined) return '';
            return unsafe.toString()
                 .replace(/&/g, "&amp;")
                 .replace(/</g, "&lt;")
                 .replace(/>/g, "&gt;")
                 .replace(/"/g, "&quot;")
                 .replace(/'/g, "&#039;");
        };

        content.innerHTML = `
            <h4>Prompt</h4>
            <pre>${escapeHtml(log.prompt)}</pre>
            <h4>${log.isError ? 'Error Message' : 'Response'}</h4>
            <pre>${escapeHtml(JSON.stringify(log.isError ? log.error : log.response, null, 2))}</pre>
        `;

        entry.appendChild(summary);
        entry.appendChild(content);
        debugLogsContainer.appendChild(entry);
    });
}

function checkForTurnCompletion() {
    const requiredSubmissions = 2;
    const roomConnections = MPLib.getRoomConnections();
    const numberOfPlayers = roomConnections ? roomConnections.size + 1 : 1;

    if (numberOfPlayers !== 2 || !isDateActive) {
        // This logic is only for 2-player dates.
        return;
    }

    if (turnSubmissions.size < requiredSubmissions) {
        console.log(`Have ${turnSubmissions.size}/${requiredSubmissions} submissions. Waiting...`);
        return;
    }

    console.log("All turns received. Checking if I am Player 1 to proceed.");

    if (amIPlayer1) {
        const myRoomId = MPLib.getLocalRoomId();
        // In a 2p date, there's only one other connection.
        const partnerRoomId = roomConnections.keys().next().value;

        const playerA_actions = turnSubmissions.get(myRoomId);
        const playerB_actions = turnSubmissions.get(partnerRoomId);

        if (!playerA_actions || !playerB_actions) {
            showError("FATAL: Could not map submissions to players. Aborting turn.");
            console.error("Submission mapping failed.", {
                myRoomId,
                partnerRoomId,
                keys: Array.from(turnSubmissions.keys())
            });
            setLoading(false);
            turnSubmissions.clear();
            return;
        }

        console.log("I am Player 1. Initiating the next turn generation.");
        initiateTurnAsPlayer1({
            playerA_actions: playerA_actions,
            playerB_actions: playerB_actions,
            playerA_notes: playerA_actions.notes,
            playerB_notes: playerB_actions.notes,
            isExplicit: isDateExplicit,
            history: historyQueue
        });

        turnSubmissions.clear();
    } else {
        // Player 2's work is done, they just wait for the next turn from P1.
        console.log("I am Player 2. My work is done for this turn, waiting for P1.");
        turnSubmissions.clear();
    }
}

async function initiateSinglePlayerTurn(turnData, history = []) {
    console.log("Initiating single-player turn...");
    setLoading(true, true);

    try {
        // In single player, we can treat the player as both Player A and Player B.
        // The orchestrator is designed for two sets of inputs, so we provide the same for both.
        const orchestratorTurnData = {
            playerA_actions: turnData,
            playerB_actions: turnData,
            playerA_notes: turnData.notes,
            playerB_notes: turnData.notes,
            isExplicit: isExplicitMode,
            history: history
        };

        const orchestratorPrompt = constructPrompt('orchestrator', orchestratorTurnData);
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");

        // We only care about Player A's output for the single player.
        await generateLocalTurn(orchestratorText, 'player1');

    } catch (error) {
        console.error("Error during single-player turn generation:", error);
        let userMessage = "Failed to generate the next turn. Please try again.";
        if (error.message && error.message.includes('503')) {
            userMessage = "The AI is currently overloaded. Please wait a moment and resubmit your turn.";
        }
        showError(userMessage);
        setLoading(false);
    }
}

/**
 * Kicks off the turn generation process. Called only by Player 1.
 * This function makes the 'orchestrator' call and distributes the plain text plan.
 */
async function initiateTurnAsPlayer1(turnData) {
    console.log("Player 1 is initiating the turn by calling the orchestrator...");
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
        loadingText.textContent = 'Generating next turn... Please wait.';
    }
    setLoading(true, true); // Use simple spinner for this phase

    try {
        const orchestratorPrompt = constructPrompt('orchestrator', turnData);
        // The orchestrator now returns a single plain text block
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");

        // Send the entire text block to Player 2
        MPLib.sendDirectToRoomPeer(currentPartnerId, {
            type: 'orchestrator_output',
            payload: orchestratorText
        });

        // Player 1 generates their own turn locally from the text block
        await generateLocalTurn(orchestratorText, 'player1');

    } catch (error) {
        console.error("Error during orchestrator call:", error);
        let userMessage = "Failed to get turn instructions from AI. Please try again.";
        if (error.message && error.message.includes('503')) {
            userMessage = "The AI is currently overloaded. Please wait a moment and resubmit your turn.";
            // Notify Player 2
            MPLib.sendDirectToRoomPeer(currentPartnerId, {
                type: 'llm_overloaded',
                payload: {}
            });
        }
        showError(userMessage);
        setLoading(false); // Hide spinner on error
    }
}



/**
 * A wrapper for the Gemini API call that includes retry logic and primary key fallback.
 */
async function callGeminiApiWithRetry(prompt, responseMimeType = "application/json") {
    // On each call, determine which API key to use.
    let apiKey = getPrimaryApiKey(); // Tries the default key first.
    if (!apiKey) {
        // If the primary key has failed or doesn't exist, use the user's input.
        apiKey = apiKeyInput.value.trim();
    }

    // If there's still no key, it means the primary failed and the user hasn't provided one.
    if (!apiKey) {
        showError("API Key is missing. Please enter your own key to continue.");
        throw new Error("API Key is missing.");
    }

    let success = false;
    let attempts = 0;
    const maxAttempts = 3; // Retries for network errors, etc.
    let lastError = null;

    while (!success && attempts < maxAttempts) {
        attempts++;
        const currentModel = AVAILABLE_MODELS[currentModelIndex];
        console.log(`Attempt ${attempts}/${maxAttempts}: Trying model ${currentModel}`);
        try {
            const responseText = await callRealGeminiAPI(apiKey, prompt, currentModel, responseMimeType);
            // If the call succeeds, we return the text.
            return responseText;

        } catch (error) {
            console.error(`Error with model ${currentModel} (Attempt ${attempts}):`, error);
            lastError = error;

            if (error.message && error.message.includes('503')) {
                throw new Error("LLM service is currently overloaded (503). Please try again shortly.");
            }

            // Specifically check for a quota error (429) or invalid key error (400) and if it was the primary key that failed.
            if (error.message && (error.message.includes('429') || error.message.includes('API_KEY_INVALID'))) {
                const primaryKey = getPrimaryApiKey();
                if (primaryKey && apiKey === primaryKey) {
                    console.warn("Primary API key has failed (invalid or quota). Switching to user input.");
                    hasPrimaryApiKeyFailed = true;

                    // Update the UI to allow the user to enter their own key.
                    apiKeyInput.disabled = false;
                    apiKeyInput.value = ''; // Clear the failed key
                    apiKeyInput.placeholder = 'Enter your Gemini API key';
                    apiKeyInput.focus();

                    // Remove the failed key from local storage to prevent auto-login with it on next refresh.
                    localStorage.removeItem('sparksync_apiKey');

                    const userMessage = "The default API key is invalid or has expired. Please enter your own key to continue.";
                    showError(userMessage);

                    // We must stop the current operation and wait for the user to act.
                    // Throw a new error that will be caught by the calling function (e.g., initiateTurn).
                    // This prevents the retry loop from continuing with the failed key.
                    throw new Error(userMessage);
                }
            }

            // For any other kind of error, we can retry a few times.
            if (attempts < maxAttempts) {
                showError(`AI Error (Attempt ${attempts}). Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    // If the loop finishes without success, throw the last error.
    throw new Error(`Failed to get valid response from AI after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
}

/** Calls the real Google AI (Gemini) API and logs the interaction for the debug panel. */
async function callRealGeminiAPI(apiKey, promptText, modelName, responseMimeType = "application/json") {
    const logEntry = {
        timestamp: new Date(),
        model: modelName,
        prompt: promptText,
        response: null,
        error: null,
        isError: false
    };
    // Add to the start of the array so newest logs are first
    llmCallHistory.unshift(logEntry);
    // Keep the log from getting too big
    if (llmCallHistory.length > 50) {
        llmCallHistory.pop();
    }

    console.log("--- LLM Query ---", { modelName, promptText, responseMimeType });

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 1.0, response_mime_type: responseMimeType },
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            let errorBody = `API request failed (${response.status})`;
            try {
                const errorJson = await response.json();
                errorBody += `: ${JSON.stringify(errorJson.error || errorJson)}`;
            } catch (e) {
                try { errorBody += `: ${await response.text()}`; } catch (e2) {}
            }
            throw new Error(errorBody);
        }

        const responseData = await response.json();
        logEntry.response = responseData; // Log success response
        console.log("--- LLM Response ---", responseData);

        if (responseData.promptFeedback && responseData.promptFeedback.blockReason) {
            throw new Error(`Request blocked by API. Reason: ${responseData.promptFeedback.blockReason}. Details: ${JSON.stringify(responseData.promptFeedback.safetyRatings || 'N/A')}`);
        }
        if (!responseData.candidates || responseData.candidates.length === 0) {
             if (typeof responseData === 'string') {
                try {
                    JSON.parse(responseData);
                    return responseData.trim();
                } catch (e) {
                    throw new Error('No candidates, response not valid JSON.');
                }
            }
            throw new Error('No candidates or unexpected API response.');
        }

        const candidate = responseData.candidates[0];
        if (candidate.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
            if (candidate.finishReason === "SAFETY") {
                throw new Error(`API call finished due to SAFETY. Ratings: ${JSON.stringify(candidate.safetyRatings || 'N/A')}`);
            } else if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
                throw new Error(`API call finished unexpectedly (${candidate.finishReason}) and no content.`);
            }
        }
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            let generatedText = candidate.content.parts[0].text;
            if (responseMimeType === "application/json") {
                const jsonMatch = generatedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch && jsonMatch[1]) {
                    generatedText = jsonMatch[1];
                }
                let trimmedText = generatedText.trim();
                 try {
                    JSON.parse(trimmedText);
                    return trimmedText;
                } catch (e) {
                    throw new Error(`Invalid JSON from API. Snippet: ${trimmedText.substring(0, 200)}...`);
                }
            } else {
                return generatedText;
            }
        } else {
            throw new Error('API candidate generated but no content parts.');
        }
    } catch (error) {
        console.error("API Error in callRealGeminiAPI:", error);
        logEntry.error = error.message;
        logEntry.isError = true;
        throw error; // Re-throw to be handled by the retry logic
    }
}

/** Renders the UI elements based on the JSON array. */
function renderUI(uiJsonArray) {
    console.log("renderUI started.");
    const initialMsgElementRef = document.getElementById('initial-message');
    uiContainer.innerHTML = '';
    if (!Array.isArray(uiJsonArray)) {
        console.error("Invalid UI data: Expected an array.", uiJsonArray);
        showError("Invalid UI data format from API.");
        if (initialMsgElementRef) {
            const clonedInitialMsg = initialMsgElementRef.cloneNode(true);
            clonedInitialMsg.style.display = 'block';
            uiContainer.appendChild(clonedInitialMsg);
        }
        return;
    }
    uiJsonArray.forEach((element, index) => {
        renderSingleElement(element, index);
    });
    const imageElement = uiContainer.querySelector('.geems-image-container');
    const analysisToggleContainer = uiContainer.querySelector('.analysis-toggle-container');
    if (imageElement && analysisToggleContainer) {
        uiContainer.insertBefore(analysisToggleContainer, imageElement.nextSibling || null);
    }
}

/** Renders a single UI element. */
function renderSingleElement(element, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'geems-element';
    let adjustedColor = null;
    if (element.color && isValidHexColor(element.color)) {
        adjustedColor = adjustColorForContrast(element.color);
        wrapper.style.borderLeftColor = adjustedColor;
        if (wrapper.classList.contains('analysis-toggle-container')) wrapper.style.borderColor = adjustedColor;
    } else {
        wrapper.style.borderLeftColor = 'transparent';
    }
    try {
        switch (element.type) {
            case 'image':
                renderImage(wrapper, element, adjustedColor);
                break;
            case 'narrative': // Alias for text
            case 'header': // Alias for text
            case 'text':
                renderText(wrapper, element, adjustedColor);
                break;
            case 'text_input': // Alias for textfield, as requested by user
            case 'input_text': // Alias for textfield
            case 'textfield':
                renderTextField(wrapper, element, adjustedColor);
                break;
            case 'checkbox':
                renderCheckbox(wrapper, element, adjustedColor);
                break;
            case 'slider':
                renderSlider(wrapper, element, adjustedColor);
                break;
            case 'input_dropdown': // Alias for radio
            case 'input_radio_probe': // Alias for radio
            case 'radio_group': // Alias for radio
            case 'radio':
                renderRadio(wrapper, element, adjustedColor);
                break;
            case 'notes': // Fallthrough to handle 'notes' as a type of hidden field
            case 'hidden':
                if (element.name === 'notes') {
                    // Create a hidden input to store the notes value in the DOM
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = 'notes';
                    hiddenInput.value = element.value || '';
                    wrapper.appendChild(hiddenInput);
                } else if (element.name === 'subjectId') {
                    currentSubjectId = element.value || "";
                }
                // Don't return here, append the wrapper so the hidden input is in the DOM
                break;
            default:
                console.warn("Unknown element type:", element.type, element);
                wrapper.textContent = `Unknown element type: ${element.type}`;
                wrapper.style.color = 'red';
        }
        uiContainer.appendChild(wrapper);
    } catch (renderError) {
        console.error(`Error rendering element ${index} (type: ${element.type}, name: ${element.name}):`, renderError, element);
        const errorWrapper = document.createElement('div');
        errorWrapper.className = 'geems-element error-message';
        errorWrapper.textContent = `Error rendering element: ${element.name || element.type}. Check console.`;
        uiContainer.appendChild(errorWrapper);
    }
}

// --- UI Element Rendering Functions ---
function renderImage(wrapper, element, adjustedColor) {
    wrapper.classList.add('geems-image-container');
    wrapper.classList.remove('geems-element');
    wrapper.style.borderLeftColor = 'transparent';
    const img = document.createElement('img');
    img.className = 'geems-image';
    const imagePrompt = element.value || 'abstract image';
    const randomSeed = Math.floor(Math.random() * 65536);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?nologo=true&safe=false&seed=${randomSeed}`;
    img.src = imageUrl;
    img.alt = element.caption || element.label || `Image: ${imagePrompt.substring(0, 50)}...`;
    img.onerror = () => {
        console.warn(`Failed to load image: ${imageUrl}`);
        img.src = `https://placehold.co/600x400/e0e7ff/4f46e5?text=Image+Load+Error`;
        img.alt = `Error loading image: ${imagePrompt.substring(0, 50)}...`;
    };
    wrapper.appendChild(img);

    // Prioritize the new 'caption' field, but fall back to 'label' for compatibility.
    const captionText = element.caption || element.label;
    if (captionText) {
        const captionDiv = document.createElement('div');
        captionDiv.className = 'geems-label text-center font-semibold mt-2'; // Re-use existing style
        if (adjustedColor) captionDiv.style.color = adjustedColor;
        captionDiv.textContent = captionText;
        wrapper.appendChild(captionDiv);
    }

    const promptText = document.createElement('p');
    promptText.className = 'geems-image-prompt';
    promptText.textContent = imagePrompt;
    wrapper.appendChild(promptText);
}

function renderText(wrapper, element, adjustedColor) {
    const textContent = element.text || element.value || '';
    const useLabel = element.label && !['narrative', 'divine_wisdom', 'player_facing_analysis'].some(namePart => element.name?.includes(namePart)); /* Removed gemini_facing_analysis from here as it's handled earlier */
    if (useLabel) {
        const label = document.createElement('label');
        label.className = 'geems-label';
        if (adjustedColor) label.style.color = adjustedColor;
        label.textContent = element.label;
        wrapper.appendChild(label);
    }
    const textElement = document.createElement('div');
    textElement.className = 'geems-text';
    textElement.innerHTML = textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/```([\s\S]*?)```/g, (match, p1) => `<pre>${p1.trim()}</pre>`).replace(/\n/g, '<br>');
    wrapper.appendChild(textElement);
}

function renderTextField(wrapper, element, adjustedColor) {
    const label = document.createElement('label');
    label.className = 'geems-label';
    label.textContent = element.label || element.name;
    label.htmlFor = element.name;
    if (adjustedColor) label.style.color = adjustedColor;
    wrapper.appendChild(label);
    const input = document.createElement('textarea');
    input.className = 'geems-textarea';
    input.id = element.name;
    input.name = element.name;
    input.rows = 4;
    input.value = element.value || '';
    input.placeholder = element.placeholder || 'Type response...';
    input.dataset.elementType = 'textfield';
    wrapper.appendChild(input);
}

function renderCheckbox(wrapper, element, adjustedColor) {
    wrapper.classList.remove('geems-element');
    wrapper.style.borderLeftColor = 'transparent';
    wrapper.style.padding = '0';
    wrapper.style.marginBottom = '0.75rem';
    const optionDiv = document.createElement('div');
    optionDiv.className = 'geems-checkbox-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = element.name;
    input.name = element.name;
    input.checked = element.value === true || String(element.value).toLowerCase() === 'true';
    input.dataset.elementType = 'checkbox';
    if (adjustedColor) input.style.accentColor = adjustedColor;
    const label = document.createElement('label');
    label.htmlFor = element.name;
    label.textContent = element.label || element.name;
    label.className = "flex-grow cursor-pointer";
    optionDiv.appendChild(input);
    optionDiv.appendChild(label);
    wrapper.appendChild(optionDiv);
}

function renderSlider(wrapper, element, adjustedColor) {
    const label = document.createElement('label');
    label.className = 'geems-label';
    label.textContent = element.label || element.name;
    label.htmlFor = element.name;
    if (adjustedColor) label.style.color = adjustedColor;
    wrapper.appendChild(label);
    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'flex items-center space-x-4 mt-2';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'geems-slider flex-grow';
    input.id = element.name;
    input.name = element.name;
    const min = parseFloat(element.min) || 0;
    const max = parseFloat(element.max) || 10;
    input.min = min;
    input.max = max;
    input.step = element.step || 1;
    const defaultValue = parseFloat(element.value);
    input.value = isNaN(defaultValue) ? (min + max) / 2 : Math.max(min, Math.min(max, defaultValue));
    input.dataset.elementType = 'slider';
    if (adjustedColor) {
        input.style.accentColor = adjustedColor;
        input.style.setProperty('--slider-thumb-color', adjustedColor);
        input.setAttribute('style', `${input.getAttribute('style') || ''} --slider-thumb-color: ${adjustedColor};`);
    }
    const valueDisplay = document.createElement('span');
    valueDisplay.className = `geems-slider-value-display font-medium w-auto text-right`;
    valueDisplay.textContent = input.value;
    if (adjustedColor) valueDisplay.style.color = adjustedColor;
    input.oninput = () => {
        valueDisplay.textContent = input.value;
    };
    sliderContainer.appendChild(input);
    sliderContainer.appendChild(valueDisplay);
    wrapper.appendChild(sliderContainer);
}

function renderRadio(wrapper, element, adjustedColor) {
    wrapper.classList.remove('geems-element');
    wrapper.style.borderLeftColor = 'transparent';
    wrapper.style.padding = '0';
    wrapper.style.marginBottom = '0.75rem';
    const label = document.createElement('label');
    label.className = 'geems-label block mb-2';
    label.textContent = element.label || element.name;
    if (adjustedColor) label.style.color = adjustedColor;
    wrapper.appendChild(label);
    let options = [];
    let defaultValue = null;
    let optionsSource = element.options || element.value;
    try {
        if (typeof optionsSource === 'string') {
            try {
                optionsSource = JSON.parse(optionsSource);
            } catch (e) {
                optionsSource = [{label: optionsSource, value: optionsSource}];
            }
        }
        if (Array.isArray(optionsSource)) {
            options = optionsSource.map(opt => {
                let currentLabel = '', currentValue = '', isDefault = false;
                if (typeof opt === 'object' && opt !== null && opt.value !== undefined) {
                    currentValue = String(opt.value);
                    currentLabel = opt.label !== undefined ? String(opt.label) : currentValue;
                    if (currentLabel.startsWith('*')) {
                        defaultValue = currentValue;
                        currentLabel = currentLabel.substring(1);
                        isDefault = true;
                    }
                } else {
                    currentValue = String(opt);
                    currentLabel = currentValue;
                    if (currentLabel.startsWith('*')) {
                        defaultValue = currentValue.substring(1);
                        currentValue = defaultValue;
                        currentLabel = defaultValue;
                        isDefault = true;
                    }
                }
                return {value: currentValue, label: currentLabel, isDefault: isDefault};
            }).filter(opt => opt !== null);
            if (defaultValue === null && element.value && typeof element.value === 'string') {
                let isValueSimpleString = true;
                try {
                    if (Array.isArray(JSON.parse(element.value))) isValueSimpleString = false;
                } catch (e) {
                }
                if (isValueSimpleString) {
                    const directValueMatch = options.find(opt => opt.value === element.value);
                    if (directValueMatch) defaultValue = directValueMatch.value;
                }
            }
        }
    } catch (e) {
        console.error("Failed radio options:", element.name, e);
    }
    if (defaultValue === null && options.length > 0) defaultValue = options[0].value;
    if (options.length > 0) {
        options.forEach((option, index) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'geems-radio-option';
            const input = document.createElement('input');
            input.type = 'radio';
            const inputId = `${element.name}_${index}`;
            input.id = inputId;
            input.name = element.name;
            input.value = option.value;
            input.checked = (option.value === defaultValue);
            input.dataset.elementType = 'radio';
            if (adjustedColor) input.style.accentColor = adjustedColor;
            const optionLabel = document.createElement('label');
            optionLabel.htmlFor = inputId;
            optionLabel.textContent = option.label;
            optionLabel.className = "flex-grow cursor-pointer";
            optionDiv.appendChild(input);
            optionDiv.appendChild(optionLabel);
            wrapper.appendChild(optionDiv);
        });
    } else {
        wrapper.innerHTML += `<p class="text-sm text-red-600">Error: No valid options for radio group '${element.name}'.</p>`;
    }
}

// --- Utility Functions ---
function collectInputState() {
    const inputs = {};
    // Collect visible inputs
    uiContainer.querySelectorAll('[data-element-type]').forEach(el => {
        const name = el.name;
        if (!name) return;
        const type = el.dataset.elementType;
        switch (type) {
            case 'textfield':
                inputs[name] = el.value;
                break;
            case 'checkbox':
                inputs[name] = el.checked;
                break;
            case 'slider':
                inputs[name] = parseFloat(el.value);
                break;
            case 'radio':
                if (el.checked) inputs[name] = el.value;
                break;
        }
    });
    // Specifically find and add the hidden 'notes' field for the current player
    const notesInput = uiContainer.querySelector('input[type="hidden"][name="notes"]');
    if (notesInput) {
        inputs['notes'] = notesInput.value;
    }

    inputs['turn'] = historyQueue.length + 1; // Still useful for single player
    return JSON.stringify(inputs);
}

function setLoading(loading, isFirstTurn = false) {
    isLoading = loading;

    if (isFirstTurn) {
        // For the first turn, use the old, simple loading spinner
        loadingIndicator.style.display = loading ? 'flex' : 'none';
        interstitialScreen.style.display = 'none';
    } else {
        // For subsequent turns, use the new interstitial screen
        loadingIndicator.style.display = 'none';
        if (loading) {
            // Reset and show the interstitial screen
            interstitialSpinner.style.display = 'flex';
            interstitialReports.classList.add('hidden');
            interstitialContinueButton.disabled = true;
            // The report containers are now dynamic, so we don't set their content here.
            // The main interstitial-reports div is hidden, which is sufficient.
            interstitialScreen.style.display = 'flex';
        }
        // When loading is false, the interstitial is hidden by the continue button, not here.
    }

    const keyPresent = apiKeyInput.value.trim().length > 0;
    submitButton.disabled = loading || !(apiKeyLocked || keyPresent);
    modeToggleButton.disabled = loading;
    resetGameButton.disabled = loading || !apiKeyLocked;
    uiContainer.querySelectorAll('input, textarea, button, .analysis-toggle-container, .geems-radio-option, .geems-checkbox-option').forEach(el => {
        if (el.id !== 'submit-turn' && el.id !== 'modeToggleButton' && el.id !== 'resetGameButton') {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') el.disabled = loading;
            if (el.classList.contains('geems-radio-option') || el.classList.contains('geems-checkbox-option') || el.classList.contains('analysis-toggle-container') || el.closest('.geems-slider-container')) {
                el.style.opacity = loading ? 0.5 : 1.0;
                el.style.pointerEvents = loading ? 'none' : 'auto';
                el.querySelectorAll('.geems-slider').forEach(slider => slider.disabled = loading);
            }
        }
    });
}

function showError(message) {
    errorDisplay.textContent = message;
    errorDisplay.style.display = 'block';
}

function hideError() {
    errorDisplay.textContent = '';
    errorDisplay.style.display = 'none';
}

function isValidHexColor(hex) {
    return typeof hex === 'string' && /^#[0-9A-F]{6}$/i.test(hex);
}

function adjustColorForContrast(hex) {
    if (!isValidHexColor(hex)) return hex;
    let r = parseInt(hex.substring(1, 3), 16), g = parseInt(hex.substring(3, 5), 16),
        b = parseInt(hex.substring(5, 7), 16);
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }
    if (l > MIN_CONTRAST_LIGHTNESS) {
        l = MIN_CONTRAST_LIGHTNESS * 0.9;
        let r1, g1, b1;
        if (s === 0) r1 = g1 = b1 = l; else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r1 = hue2rgb(p, q, h + 1 / 3);
            g1 = hue2rgb(p, q, h);
            b1 = hue2rgb(p, q, h - 1 / 3);
        }
        const toHex = x => {
            const hexVal = Math.round(x * 255).toString(16);
            return hexVal.length === 1 ? '0' + hexVal : hexVal;
        };
        return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
    }
    return hex;
}

function showClipboardMessage(message, isError = false) {
    clipboardMessage.textContent = message;
    clipboardMessage.style.color = isError ? '#dc2626' : '#16a34a';
    setTimeout(() => {
        clipboardMessage.textContent = '';
    }, 3000);
}

function updateModeButtonVisuals() {
    if (isExplicitMode) {
        modeToggleButton.textContent = '18+ Mode: On';
        modeToggleButton.classList.remove('standard-mode');
    } else {
        modeToggleButton.textContent = '18+ Mode: Off';
        modeToggleButton.classList.add('standard-mode');
    }
}

// --- Multiplayer Functions ---

/** Shows a basic notification */
function showNotification(message, type = 'info', duration = 4000) {
    // Use your existing showClipboardMessage or create a dedicated notification area
    console.log(`[Notification-${type}] ${message}`);
    showClipboardMessage(message, type === 'error' || type === 'warn');
    // If you have a dedicated notification area:
    // const notificationArea = document.getElementById('notification-area');
    // if(notificationArea) { ... create and append element ... }
}


/** Updates the peer list UI in the footer */
function updatePeerListUI() {
    if (!peerListContainer) return; // Check if container exists
    peerListContainer.innerHTML = ''; // Clear previous icons

    const peers = MPLib.getRoomConnections ? Array.from(MPLib.getRoomConnections().keys()) : [];
    const localId = MPLib.getLocalMasterId ? MPLib.getLocalMasterId() : null;
    // const hostId = MPLib.getHostPeerId ? MPLib.getHostPeerId() : null; // This concept is removed
    const isViewingRemote = localGameStateSnapshot !== null;

    // Add local player icon
    if (localId) {
        const localIcon = createPeerIcon(localId, 'You', true, false); // isSelf=true, isHost=false (removed)
        localIcon.onclick = () => {
            if (isViewingRemote) {
                console.log("Clicked local icon - restoring local state.");
                restoreLocalState();
                // Submit button state is handled within restoreLocalState
                // Highlight is cleared within restoreLocalState calling this function again
            } else {
                console.log("Clicked local icon - already viewing local state.");
            }
        };
        peerListContainer.appendChild(localIcon);
    }

    // Add remote peer icons
    peers.forEach(peerId => {
        if (peerId !== localId) { // Don't add self again
            const conn = MPLib.getRoomConnections().get(peerId);
            // Check for valid connection object (MPLib might store 'connecting' string temporarily)
            if (conn && typeof conn === 'object' && conn.open) { // Ensure it's an open DataConnection
                const peerIcon = createPeerIcon(peerId, peerId.slice(-6), false, false); // isHost is always false now
                peerIcon.onclick = () => {
                    console.log(`Clicked remote peer icon: ${peerId.slice(-6)}`);
                    // Request game state from this peer
                    console.log(`Requesting game state from ${peerId.slice(-6)}...`);
                    MPLib.sendDirectToRoomPeer(peerId, {type: 'request_game_state'});
                    showNotification(`Requesting state from ${peerId.slice(-6)}...`, 'info', 2000);
                    // Highlight this peer (will be updated fully when state arrives)
                    highlightPeerIcon(peerId); // Indicate attempt to view
                    // submitButton.disabled = true; // Handled in loadGameState
                }
                peerListContainer.appendChild(peerIcon);

            } else {
                console.log(`Skipping peer icon for ${peerId.slice(-6)} - connection not fully established or is invalid.`);
                // Optionally add a placeholder icon for connecting peers
            }
        }
    });


    // Highlight the peer whose state is currently being viewed
    // Highlighting is now mainly handled by calls to highlightPeerIcon when clicking or receiving state.
    // Ensure no highlights if viewing local state
    if (!isViewingRemote) {
        highlightPeerIcon(null); // Clear highlights if viewing local
    }
}

/** Creates a single peer icon element */
function createPeerIcon(peerId, labelText, isSelf, isHost) {
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'peer-icon-wrapper tooltip';
    iconWrapper.dataset.peerId = peerId;

    const icon = document.createElement('span');
    icon.className = 'peer-icon';
    icon.style.backgroundColor = isSelf ? '#4f46e5' : '#71717a'; // Blue for self, gray for others
    if (isHost) {
        icon.style.borderColor = '#facc15'; // Yellow border for host
        icon.style.borderWidth = '2px';
        icon.style.borderStyle = 'solid';
    }
    // Add simple initial/icon, e.g., first letter of label
    icon.textContent = labelText.slice(-4).toUpperCase();

    // Tooltip text
    const tooltipText = document.createElement('span');
    tooltipText.className = 'tooltiptext';
    tooltipText.textContent = `${labelText}${isHost ? ' (Host)' : ''} - ${peerId}`;

    iconWrapper.appendChild(icon);
    iconWrapper.appendChild(tooltipText);

    return iconWrapper;
}

/** Highlights a specific peer icon */
function highlightPeerIcon(peerIdToHighlight) {
    if (!peerListContainer) return;
    peerListContainer.querySelectorAll('.peer-icon-wrapper').forEach(icon => {
        if (icon.dataset.peerId === peerIdToHighlight) {
            icon.classList.add('viewing');
            // Ensure self icon isn't highlighted if viewing remote
            if (peerIdToHighlight !== MPLib.getLocalMasterId()) {
                const selfIcon = peerListContainer.querySelector(`.peer-icon-wrapper[data-peer-id="${MPLib.getLocalMasterId()}"]`);
                if (selfIcon) selfIcon.classList.remove('viewing');
            }
        } else {
            icon.classList.remove('viewing');
        }
    });
    // Ensure local icon is highlighted if no remote peer is specified (i.e., back to local view)
    if (peerIdToHighlight === null && MPLib.getLocalMasterId()) {
        const selfIcon = peerListContainer.querySelector(`.peer-icon-wrapper[data-peer-id="${MPLib.getLocalMasterId()}"]`);
        if (selfIcon) selfIcon.classList.add('viewing');
    }
}

/** Add CSS for Peer Icons and Tooltips (inject or add to styles.css) */
function addPeerIconStyles() {
    const styleId = 'peer-icon-styles';
    if (document.getElementById(styleId)) return; // Avoid adding multiple times

    const css = `
        .peer-list-container {
            display: flex;
            gap: 0.75rem; /* 12px */
            padding: 0.5rem 1rem; /* 8px 16px */
            justify-content: center;
            align-items: center;
            background-color: rgba(255, 255, 255, 0.1); /* Slightly transparent background */
            border-top: 1px solid rgba(209, 213, 219, 0.5); /* Light border */
            margin-top: 1rem; /* Space above peer list */
            flex-wrap: wrap; /* Allow wrapping on small screens */
        }
        .peer-icon-wrapper {
            position: relative;
            display: inline-block;
        }
        .peer-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2.5rem; /* 40px */
            height: 2.5rem; /* 40px */
            border-radius: 50%;
            color: white;
            font-weight: bold;
            font-size: 1rem; /* 16px */
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            box-sizing: border-box; /* Include border in size */
            user-select: none; /* Prevent text selection */
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
        }
        .peer-icon-wrapper:hover .peer-icon {
            transform: scale(1.1);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }
        /* Highlight style for viewing peer/self */
        .peer-icon-wrapper.viewing .peer-icon {
             /* Use a distinct outline or shadow to indicate viewing */
             outline: 3px solid #a78bfa; /* Purple outline */
             outline-offset: 2px;
             box-shadow: 0 0 10px rgba(167, 139, 250, 0.7); /* Optional glow */
             /* transform: scale(1.05); // Can conflict with hover */
        }
        /* Tooltip styles */
        .tooltip .tooltiptext {
            visibility: hidden;
            width: max-content; /* Adjust width based on content */
            max-width: 200px; /* Max width */
            background-color: #555;
            color: #fff;
            text-align: center;
            border-radius: 6px;
            padding: 5px 8px;
            position: absolute;
            z-index: 10;
            bottom: 135%; /* Position above the icon */
            left: 50%;
            transform: translateX(-50%); /* Center the tooltip using transform */
            opacity: 0;
            transition: opacity 0.3s;
            font-size: 0.75rem; /* 12px */
            word-wrap: break-word; /* Prevent long IDs from breaking layout */
            pointer-events: none; /* Tooltip should not interfere with clicks */
        }
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
        }
        .tooltip .tooltiptext::after { /* Tooltip arrow */
            content: "";
            position: absolute;
            top: 100%;
            left: 50%;
            margin-left: -5px;
            border-width: 5px;
            border-style: solid;
            border-color: #555 transparent transparent transparent;
        }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = styleId;
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
}


// --- Multiplayer Event Handlers (Callbacks for MPLib) ---

function handleMasterConnected(id) {
    console.log(`Connection to master directory established. My master ID is ${id.slice(-6)}`);
    showNotification(`Connected to the network!`, 'success');
    // Now that we are on the network, join a default room.
    const defaultRoom = DEFAULT_LOBBY;
    currentRoomName = defaultRoom; // Track the current room
    MPLib.joinRoom(defaultRoom);
}

function handleMasterDisconnected() {
    showError("Connection to the master directory has been lost. Room list may be outdated.");
}

function handleNewMasterEstablished() {
    console.log("Established connection to a new master. Reporting my status.");
    // Don't report status if we aren't in a room yet
    if (currentRoomName) {
        MPLib.sendToMaster({
            type: 'update_status',
            payload: {
                newRoom: currentRoomName,
                isPublic: currentRoomIsPublic
            }
        });
    }
}

function handleDirectoryUpdate(directory) {
    console.log("Received global directory update:", directory);
    globalRoomDirectory = directory;
    renderGlobalRoomList();
}

function handleRoomConnected(id) {
    console.log(`Successfully joined room '${currentRoomName}' with ID: ${id.slice(-6)}`);
    // Announce our location to the master directory
    MPLib.sendToMaster({
        type: 'update_status',
        payload: {
            newRoom: currentRoomName,
            isPublic: currentRoomIsPublic
        }
    });
}

function handleRoomPeerJoined(peerId, conn) {
    console.log(`MPLib Event: Peer joined room - ${peerId.slice(-6)}`);
    showNotification(`Peer ${peerId.slice(-6)} joined the room.`, 'success', 2000);

    // If a date is active, don't disrupt the UI by re-rendering the lobby.
    if (isDateActive) {
        console.log("A peer joined, but a date is active. Skipping lobby render.");
        return;
    }
    renderLobby();

    conn.on('open', () => {
        console.log(`Data connection to room peer ${peerId.slice(-6)} opened. Re-rendering lobby.`);
        // Also check here, as the state could have changed.
        if (isDateActive) {
            console.log("Peer connection opened, but a date is now active. Skipping lobby render.");
            return;
        }
        renderLobby();
    });
}

function handleRoomPeerLeft(peerId) {
    console.log(`MPLib Event: Peer left room - ${peerId.slice(-6)}`);
    showNotification(`Peer ${peerId.slice(-6)} left the room.`, 'warn', 2000);

    // Critical check: if the person who left was our date partner, end the date.
    if (isDateActive && peerId === currentPartnerId) {
        console.log("Dating partner has disconnected. Ending date.");
        showError("Your partner has disconnected. The date has ended.");
        // Reset date state variables
        isDateActive = false;
        currentPartnerId = null;
        amIPlayer1 = false;
        turnSubmissions.clear();
        // Now, it's safe to render the lobby, which will show the lobby and hide the game.
        renderLobby();
        return; // Important to stop here.
    }

    // If we are in a date, but the person who left was NOT our partner, don't do anything to the main UI.
    if (isDateActive) {
        console.log("A non-partner peer left the room. Ignoring lobby render.");
        return;
    }

    // If we are not in a date, it's safe to re-render the lobby.
    renderLobby();
}

function handleRoomDataReceived(senderId, data) {
    console.log(`MPLib Event: Room data received from ${senderId.slice(-6)}`, data);
    if (!data || !data.type) {
        console.warn("Received data without type from room peer:", senderId.slice(-6));
        return;
    }

    switch (data.type) {
        case 'date_proposal':
            console.log(`Received date proposal from ${senderId}`);
            incomingProposal = {
                proposerId: senderId,
                proposerExplicitMode: data.payload?.proposerExplicitMode || false
            };
            showProposalModal();
            break;
        case 'date_accepted':
            console.log(`Date proposal accepted by ${senderId}`);
            showNotification(`Your date with ${senderId.slice(-4)} was accepted! Starting...`, "success");
            const accepterExplicitMode = data.payload?.accepterExplicitMode || false;
            isDateExplicit = isExplicitMode && accepterExplicitMode;
            console.log(`Date explicit mode set to: ${isDateExplicit}`);
            startNewDate(senderId, true);
            break;
        case 'date_declined':
            console.log(`Date proposal declined by ${senderId}`);
            showNotification(`Your date with ${senderId.slice(-4)} was declined.`, "warn");
            const button = document.querySelector(`.propose-date-button[data-peer-id="${senderId}"]`);
            if (button) {
                button.disabled = false;
                button.textContent = 'Propose Date';
            }
            break;

        case 'turn_submission':
            console.log(`Received turn submission from ${senderId.slice(-6)}`);
            if (isDateActive) {
                // The payload is already a JS object, no need to parse it again.
                const actions = data.payload;
                // Use the room ID as the key
                turnSubmissions.set(senderId, actions);
                checkForTurnCompletion();
            }
            break;

        case 'new_turn_ui':
            console.log(`Received new turn UI from ${senderId}`);
            if (isDateActive && !amIPlayer1) {
                currentUiJson = data.payload;
                renderUI(currentUiJson);
                playTurnAlertSound();
                submitButton.disabled = false;
                setLoading(false, true);
            }
            break;
        case 'orchestrator_output':
            console.log(`Received orchestrator output from ${senderId}`);
            if (isDateActive && !amIPlayer1) {
                generateLocalTurn(data.payload, 'player2');
            }
            break;
        case 'profile_update':
            console.log(`Received profile update from ${senderId.slice(-6)}`, data.payload);
            // Use the Master ID for storage to keep it consistent
            const masterId = MPLib.getRoomConnections().get(senderId)?.metadata?.masterId || senderId;
            if (!remoteGameStates.has(masterId)) {
                remoteGameStates.set(masterId, {});
            }
            remoteGameStates.get(masterId).profile = data.payload;
            console.log(`Updated remote profile for ${masterId.slice(-6)}`);

            // Re-render the lobby if it's currently being viewed to show updates live.
            if (lobbyContainer.style.display === 'block') {
                renderLobby();
            }
            break;
        case 'new_turn_ui':
            console.log(`Received new turn UI from ${senderId}`);
            if (isDateActive && !amIPlayer1) {
                currentUiJson = data.payload;
                renderUI(currentUiJson);
                playTurnAlertSound();
                submitButton.disabled = false;
                setLoading(false, true);
            }
            break;
        case 'graceful_disconnect':
            console.log(`Received graceful disconnect from ${senderId.slice(-6)}`);
            // Manually close the connection. The 'onclose' handler in MPLib
            // will then trigger the onRoomPeerLeft callback, which handles UI updates.
            MPLib.closeConnection(senderId);
            break;
        case 'llm_overloaded':
            console.log("Received LLM overloaded message from partner.");
            showError("The AI is currently overloaded. Please wait a moment and resubmit your turn.");
            setLoading(false); // This will re-enable the submit button and hide loading indicators.
            break;
        default:
            console.warn(`Received unknown message type '${data.type}' from ${senderId.slice(-6)}`);
    }
}

function handleStatusUpdate(message) {
    console.log(`MPLib Status: ${message}`);
}

function handleError(type, error) {
    console.error(`MPLib Error (${type}):`, error);
}

// --- UI Rendering ---

function renderGlobalRoomList() {
    if (isDateActive) return; // Do not render the room list if a date is active
    const roomListContainer = document.getElementById('room-list');
    const directoryContainer = document.getElementById('global-directory-container');
    if (!roomListContainer || !directoryContainer) return;

    directoryContainer.style.display = 'block'; // Make sure the whole section is visible
    roomListContainer.innerHTML = ''; // Clear old list

    const { rooms } = globalRoomDirectory;

    if (Object.keys(rooms).length === 0) {
        roomListContainer.innerHTML = '<p class="text-gray-500">No public rooms are active. Why not create one?</p>';
        return;
    }

    // Sort rooms by name for a consistent order
    const sortedRoomNames = Object.keys(rooms).sort();

    sortedRoomNames.forEach(roomName => {
        const room = rooms[roomName];
        const card = document.createElement('div');
        card.className = 'room-card';

        const title = document.createElement('h3');
        title.textContent = roomName;
        card.appendChild(title);

        const occupantCount = document.createElement('p');
        occupantCount.textContent = `(${room.occupants.length} online)`;
        card.appendChild(occupantCount);

        const joinButton = document.createElement('button');
        joinButton.className = 'geems-button join-room-btn';
        joinButton.textContent = 'Join';
        joinButton.dataset.roomName = roomName;

        if (roomName === currentRoomName) {
            joinButton.disabled = true;
            joinButton.textContent = 'Current';
            card.classList.add('current-room');
        } else {
            joinButton.addEventListener('click', () => switchToRoom(roomName, true));
        }
        card.appendChild(joinButton);

        roomListContainer.appendChild(card);
    });
}


// --- Event Listeners ---

// Modify the original click listener
submitButton.addEventListener('click', () => {
    if (isLoading) return;
    submitButton.disabled = true; // Prevent double-clicks

    // --- Single source of truth for actions ---
    const playerActions = JSON.parse(collectInputState());
    updateLocalProfileFromTurn(playerActions); // Update profile regardless of mode

    if (isDateActive) {
        // --- Symmetrical Two-Player Date Logic ---
        const myRoomId = MPLib.getLocalRoomId();

        if (myRoomId) {
            turnSubmissions.set(myRoomId, playerActions);
            console.log(`Locally recorded submission for ${myRoomId.slice(-6)}`);
        } else {
            console.error("Could not get local room ID to record submission.");
            submitButton.disabled = false;
            showError("A local error occurred. Could not submit turn.");
            return;
        }

        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.textContent = 'Waiting for partner...';
        }
        setLoading(true, true);

        showNotification("Actions submitted. Waiting for partner to submit...", "info");

        // Broadcast actions to everyone in the room.
        MPLib.broadcastToRoom({ type: 'turn_submission', payload: playerActions });

        checkForTurnCompletion();

    } else {
        // --- Single-Player Logic ---
        console.log("Submit button clicked (single-player mode).");
        initiateSinglePlayerTurn(playerActions, historyQueue);
    }
});
// --- MODIFICATION END: Long Press Logic ---


apiKeyInput.addEventListener('input', () => {
    const keyPresent = apiKeyInput.value.trim().length > 0;
    submitButton.disabled = isLoading || !(apiKeyLocked || keyPresent);
    resetGameButton.disabled = isLoading || (!apiKeyLocked && !keyPresent);
});

modeToggleButton.addEventListener('click', () => {
    if (isLoading) return;
    isExplicitMode = !isExplicitMode;
    console.log(`18+ Mode Toggled: ${isExplicitMode ? 'On' : 'Off'}`);
    updateModeButtonVisuals();
    autoSaveGameState();
});

resetGameButton.addEventListener('click', () => {
    if (isLoading || resetGameButton.disabled) return;
    if (confirm('Reset game? This will clear local progress. Are you sure?')) {
        console.log("Resetting game state...");
        // Clear all relevant local storage items
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.removeItem('sparksync_apiKey');
        localStorage.removeItem(LOCAL_PROFILE_KEY); // Also delete the user's profile
        localStorage.removeItem('sparksync_hivemind');
        localStorage.removeItem('sparksync_lastLobby');
        console.log("Cleared localStorage, including user profile.");

        // Reload the page to go back to the lobby selection
        window.location.reload();
    }
});

// --- Initial Game Setup ---

/** Renders the lobby UI */
function renderLobby() {
    if (isDateActive) {
        console.log("renderLobby call ignored: a date is active.");
        return;
    }
    console.log("Entering renderLobby with dynamic profiles.");
    if (!lobbyContainer) return;

    lobbyContainer.style.display = 'block';
    if(gameWrapper) gameWrapper.style.display = 'none';

    lobbyContainer.innerHTML = '<h2>Welcome to the Lobby</h2>';
    const grid = document.createElement('div');
    grid.className = 'lobby-grid';

    const localMasterId = MPLib.getLocalMasterId();
    const localProfile = getLocalProfile();

    // Create a list of all players to render, including the local player
    const playersToRender = [];

    // Add the local player
    if (localMasterId) {
        playersToRender.push({
            id: localMasterId,
            profile: localProfile,
            isLocal: true
        });
    }

    // Add remote players
    const remotePeers = MPLib.getRoomConnections ? Array.from(MPLib.getRoomConnections().values()) : [];
    remotePeers.forEach(conn => {
        if (conn && conn.open) {
            const peerMasterId = conn.metadata?.masterId || conn.peer; // Fallback to room ID
            const remoteState = remoteGameStates.get(peerMasterId) || {};
            playersToRender.push({
                id: peerMasterId,
                profile: remoteState.profile || { name: `User-${peerMasterId.slice(-4)}`, gender: "Unknown", physical: {} },
                isLocal: false,
                roomConnection: conn // Pass the connection for the button
            });
        }
    });

    if (playersToRender.length <= 1) { // Only local player is here
        grid.innerHTML = '<p>No other users are currently online. Please wait for someone to connect.</p>';
    } else {
        playersToRender.forEach(player => {
            const card = document.createElement('div');
            card.className = 'profile-card';
            if (player.isLocal) {
                card.classList.add('local-player-card');
            }

            const avatarPrompt = generateAvatarPrompt(player.profile);
            const randomSeed = player.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const avatarUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(avatarPrompt)}?seed=${randomSeed}&nologo=true&safe=false`;

            const avatar = document.createElement('div');
            avatar.className = 'profile-avatar';
            avatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar for ${player.profile.name}">`;

            const name = document.createElement('div');
            name.className = 'profile-name';
            name.textContent = player.profile.name || `User-${player.id.slice(-4)}`;

            const gender = document.createElement('div');
            gender.className = 'profile-gender';
            gender.textContent = player.profile.gender || 'Unknown';

            card.appendChild(avatar);
            card.appendChild(name);
            card.appendChild(gender);

            if (!player.isLocal) {
                const button = document.createElement('button');
                button.className = 'geems-button propose-date-button';
                button.dataset.masterId = player.id; // Store the persistent masterId

                if (player.roomConnection && player.roomConnection.open) {
                    button.textContent = 'Propose Date';
                    button.disabled = false;
                    button.onclick = (event) => {
                        const targetMasterId = event.target.dataset.masterId;

                        // Find the correct room connection using the masterId
                        const connections = MPLib.getRoomConnections();
                        let targetRoomId = null;
                        for (const [roomId, conn] of connections.entries()) {
                            if (conn.metadata?.masterId === targetMasterId) {
                                targetRoomId = roomId;
                                break;
                            }
                        }

                        if (targetRoomId) {
                            console.log(`Proposing date to masterId ${targetMasterId.slice(-6)} (via roomId ${targetRoomId.slice(-6)})`);
                            const payload = { proposerExplicitMode: isExplicitMode };
                            MPLib.sendDirectToRoomPeer(targetRoomId, { type: 'date_proposal', payload: payload });
                            event.target.disabled = true;
                            event.target.textContent = 'Request Sent';
                        } else {
                            showError("Could not find the player to send the proposal. They may have disconnected.");
                            console.error("Failed to find room connection for masterId:", targetMasterId);
                        }
                    };
                } else {
                    button.textContent = 'Connecting...';
                    button.disabled = true;
                }
                card.appendChild(button);
            } else {
                const localPlayerLabel = document.createElement('div');
                localPlayerLabel.className = 'local-player-label';
                localPlayerLabel.textContent = '(This is you)';
                card.appendChild(localPlayerLabel);
            }

            grid.appendChild(card);
        });
    }

    lobbyContainer.appendChild(grid);
}

/** Shows the date proposal modal and sets up its button handlers. */
function showProposalModal() {
    if (!proposalModal || !incomingProposal) return;

    const proposerMasterId = MPLib.getRoomConnections()?.get(incomingProposal.proposerId)?.metadata?.masterId;
    const proposerProfile = remoteGameStates.get(proposerMasterId)?.profile;
    proposerName.textContent = proposerProfile?.name || `User-${incomingProposal.proposerId.slice(-4)}`;

    // Use .onclick to easily overwrite previous listeners
    proposalAcceptButton.onclick = () => {
        if (!incomingProposal) return;
        console.log(`Accepting date from ${incomingProposal.proposerId}`);
        const payload = {
            accepterExplicitMode: isExplicitMode
        };
        MPLib.sendDirectToRoomPeer(incomingProposal.proposerId, { type: 'date_accepted', payload: payload });
        proposalModal.style.display = 'none';

        // Determine if the date is explicit
        isDateExplicit = isExplicitMode && incomingProposal.proposerExplicitMode;
        console.log(`Date explicit mode set to: ${isDateExplicit}`);

        startNewDate(incomingProposal.proposerId, false); // We are Player 2 (receiver)
        incomingProposal = null; // Clear the stored proposal
    };

    proposalDeclineButton.onclick = () => {
        if (!incomingProposal) return;
        console.log(`Declining date from ${incomingProposal.proposerId}`);
        MPLib.sendDirectToRoomPeer(incomingProposal.proposerId, { type: 'date_declined' });
        proposalModal.style.display = 'none';
        incomingProposal = null; // Clear the stored proposal
    };

    proposalModal.style.display = 'flex';
}
window.showProposalModal = showProposalModal; // Expose for testing

/** Transitions from lobby to game view and initializes date state */
function startNewDate(partnerId, iAmPlayer1) {
    console.log(`Starting new date with ${partnerId}. Am I Player 1? ${iAmPlayer1}`);

    isDateActive = true;
    currentPartnerId = partnerId;
    amIPlayer1 = iAmPlayer1;
    turnSubmissions.clear(); // Ensure clean state for the new date

    // Hide lobby, show game
    const directoryContainer = document.getElementById('global-directory-container');
    if(directoryContainer) directoryContainer.style.display = 'none';
    if(lobbyContainer) lobbyContainer.style.display = 'none';
    if(gameWrapper) gameWrapper.style.display = 'block';

    const partnerMasterId = MPLib.getRoomConnections()?.get(partnerId)?.metadata?.masterId;
    const partnerProfile = remoteGameStates.get(partnerMasterId)?.profile;
    const partnerName = partnerProfile?.name || `User-${partnerId.slice(-4)}`;

    // This will be replaced by the actual first turn UI from the AI
    uiContainer.innerHTML = `<div class="text-center p-8"><h2>Date with ${partnerName} has started!</h2></div>`;

    // Player 1 is responsible for fetching the first turn
    if (iAmPlayer1) {
        console.log("I am Player 1, fetching the first turn.");
        fetchFirstTurn();
    } else {
        // Player 2 just waits, show a loading indicator.
        uiContainer.innerHTML = `<div class="text-center p-8"><h2>Date with ${partnerName} has started! Waiting for first turn...</h2></div>`;
        setLoading(true, true); // Use simple spinner
    }
}

async function fetchFirstTurn() {
    console.log("Fetching first turn using the Orchestrator...");
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
        loadingText.textContent = 'Inventing a new scenario... Please wait.';
    }
    setLoading(true, true); // Use the simple spinner for the first turn

    // Load the local profile to provide context to the AI if it exists.
    const localProfile = getLocalProfile();
    const profileString = `Player A's saved profile: ${JSON.stringify(localProfile)}. If profile data exists, use it when creating the notes and UI. Otherwise, ensure the UI probes for it.`;

    // For the first turn, there are no previous actions or notes.
    // The orchestrator will be guided by the 'firstrun_addendum'.
    const initialTurnData = {
        playerA_actions: { turn: 0, action: "game_start" },
        playerB_actions: { turn: 0, action: "game_start" },
        // The notes provide a clear starting point for the orchestrator AI.
        playerA_notes: `## Dr. Gemini's Log\nThis is the very first turn of a new blind date. As Player 1, I have arrived first. Please generate a new scene and starting UI for both players. ${profileString}`,
        playerB_notes: "## Dr. Gemini's Log\nThis is the very first turn of a new blind date. As Player 2, I am just arriving. Please generate a new scene and starting UI for both players.",
        isExplicit: isDateExplicit,
        // Add a flag to indicate this is the first turn, so the prompt can be adjusted.
        isFirstTurn: true
    };

    // We can now just call the same function used for all subsequent turns.
    // This simplifies the logic and ensures consistency.
    await initiateTurnAsPlayer1(initialTurnData);
}


// --- New Lobby System ---
const DEFAULT_LOBBY = "The Hive";
const PRESET_LOBBIES = ["The Abattoir", "The Dollhouse", "The Asylum"];
const HIVEMIND_STORAGE_KEY = 'sparksync_hivemind';

const lobbySelectionScreen = document.getElementById('lobby-selection-screen');
const lobbySelect = document.getElementById('lobby-select');
const customLobbyInput = document.getElementById('custom-lobby-input');
const joinLobbyButton = document.getElementById('join-lobby-button');

function populateLobbySelector() {
    const savedLobbies = JSON.parse(localStorage.getItem(HIVEMIND_STORAGE_KEY) || '[]');
    const allLobbies = [...new Set([...PRESET_LOBBIES, ...savedLobbies])];

    lobbySelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = DEFAULT_LOBBY;
    defaultOption.textContent = DEFAULT_LOBBY;
    lobbySelect.appendChild(defaultOption);

    allLobbies.forEach(lobbyName => {
        if (lobbyName !== DEFAULT_LOBBY) {
            const option = document.createElement('option');
            option.value = lobbyName;
            option.textContent = lobbyName;
            lobbySelect.appendChild(option);
        }
    });
}

function saveLobbyToHivemind(lobbyName) {
    if (!lobbyName || PRESET_LOBBIES.includes(lobbyName) || lobbyName === DEFAULT_LOBBY) {
        return;
    }
    const savedLobbies = JSON.parse(localStorage.getItem(HIVEMIND_STORAGE_KEY) || '[]');
    if (!savedLobbies.includes(lobbyName)) {
        savedLobbies.push(lobbyName);
        localStorage.setItem(HIVEMIND_STORAGE_KEY, JSON.stringify(savedLobbies));
        console.log(`Saved lobby "${lobbyName}" to hivemind.`);
    }
}

function switchToRoom(roomName, isPublic) {
    console.log(`Switching to room: ${roomName} (Public: ${isPublic})`);

    // Don't do anything if we're already in that room
    if (roomName === currentRoomName) {
        showNotification("You are already in this room.", "warn");
        return;
    }

    // Provide immediate UI feedback
    const lobby = document.getElementById('lobby-container');
    if (lobby) {
        lobby.innerHTML = `<h2>Joining ${roomName}...</h2>`;
    }

    // Leave the old room's network
    MPLib.leaveRoom();

    // Set the new room name and join the new network
    currentRoomName = roomName;
    currentRoomIsPublic = isPublic;
    MPLib.joinRoom(roomName);

    // The 'handleRoomConnected' callback will automatically notify the master directory
    // of our new location once the connection is established.
}

function initializeGame() {
    console.log("Initializing Flagged with new Master Directory architecture...");

    // Handle interstitial continue button click
    interstitialContinueButton.addEventListener('click', () => {
        interstitialScreen.style.display = 'none';
        window.scrollTo(0, 0); // Scroll to top
    });

    // Hide the game wrapper and show the lobby selection by default
    if(gameWrapper) gameWrapper.style.display = 'none';
    if(lobbyContainer) lobbyContainer.style.display = 'none';
    if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'block';

    populateLobbySelector(); // Populate dropdown with any saved/preset lobbies

    // This listener handles the initial login/API key submission
    joinLobbyButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            // This case should now only be hit if the primary key fails and the user deletes it.
            showError("API Key is required to connect.");
            return;
        }

        // Save API key and hide the selection screen
        localStorage.setItem('sparksync_apiKey', apiKey);
        apiKeyLocked = true;
        hideError();
        if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'none';
        lobbyContainer.style.display = 'block'; // Show the lobby container (which will initially be empty)

        // The main entrypoint to the multiplayer library
        MPLib.initialize({
            debugLevel: 1,
            onStatusUpdate: handleStatusUpdate,
            onError: handleError,
            onMasterConnected: handleMasterConnected,
            onMasterDisconnected: handleMasterDisconnected,
            onNewMasterEstablished: handleNewMasterEstablished,
            onDirectoryUpdate: handleDirectoryUpdate,
            onRoomConnected: handleRoomConnected,
            onRoomPeerJoined: handleRoomPeerJoined,
            onRoomPeerLeft: handleRoomPeerLeft,
            onRoomPeerDisconnected: (masterId) => {
                console.log(`Peer with masterId ${masterId.slice(-6)} has disconnected. Cleaning up state.`);
                remoteGameStates.delete(masterId);
                // No need to call renderLobby here, as onRoomPeerLeft already does.
            },
            onRoomDataReceived: handleRoomDataReceived,
        });
    });

    // Add listeners for the new room creation buttons
    const createPublicBtn = document.getElementById('create-public-room-btn');
    const createPrivateBtn = document.getElementById('create-private-room-btn');
    const newRoomInput = document.getElementById('new-room-name-input');

    createPublicBtn.addEventListener('click', () => {
        const roomName = newRoomInput.value.trim();
        if (roomName) {
            if (globalRoomDirectory.rooms[roomName]) {
                showError("A public room with this name already exists.");
                return;
            }
            switchToRoom(roomName, true);
            newRoomInput.value = '';
        }
    });

    createPrivateBtn.addEventListener('click', () => {
        const roomName = newRoomInput.value.trim();
        if (roomName) {
            // No check needed for private rooms as they are not listed
            switchToRoom(roomName, false);
            newRoomInput.value = '';
        }
    });

    // --- New Key Management and Auto-Login Logic ---
    const primaryApiKey = getPrimaryApiKey();
    const savedApiKey = localStorage.getItem('sparksync_apiKey');

    if (primaryApiKey && !hasPrimaryApiKeyFailed) {
        apiKeyInput.value = primaryApiKey;
        apiKeyInput.disabled = true;
        apiKeyInput.placeholder = "Using default key";
        console.log("Using primary API key.");
        joinLobbyButton.click(); // Auto-login with the primary key
    } else if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        console.log("Using saved API key.");
        joinLobbyButton.click(); // Auto-login with a previously user-provided key
    } else {
         console.log("No primary or saved key found. Waiting for user input.");
    }

    // --- Debug Panel Listeners ---
    if (toggleDebugPanelButton && debugPanel) {
        toggleDebugPanelButton.addEventListener('click', () => {
            const isHidden = debugPanel.style.display === 'none';
            if (isHidden) {
                renderDebugPanel();
                debugPanel.style.display = 'flex';
            } else {
                debugPanel.style.display = 'none';
            }
        });
    }
    if (debugPanelCloseButton && debugPanel) {
        debugPanelCloseButton.addEventListener('click', () => {
            debugPanel.style.display = 'none';
        });
    }

    // Graceful disconnect
    window.addEventListener('beforeunload', () => {
        // This is a best-effort attempt. Most modern browsers are strict
        // about what can be done in this event handler.
        MPLib.broadcastToRoom({ type: 'graceful_disconnect' });
        console.log("Sent graceful disconnect message.");
    });
}

function createInitialMessage() {
    const msgDiv = document.createElement('div');
    msgDiv.id = 'initial-message';
    msgDiv.className = 'text-center text-gray-500 p-6 bg-white rounded-lg shadow';
    uiContainer.appendChild(msgDiv);
    return msgDiv;
}

window.hideInterstitial = function() {
    const screen = document.getElementById('interstitial-screen');
    if (screen) {
        screen.style.display = 'none';
    }
}

// Ensure DOM is fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeGame);
