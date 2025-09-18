// Import prompts from the separate file (if still needed for single-player)
import {geemsPrompts, analyzer_prompt, sceneFeatures, getDynamicSceneOptions, getMinigameActions, getMinigameOutcome} from './prompts.js';
import MPLib from './mp.js';
// Assuming MPLib is globally available after including mp.js or imported if using modules
// import MPLib from './mp.js'; // Uncomment if using ES6 modules for MPLib

// --- Game State Variables ---
let hasPrimaryApiKeyFailed = false;
let historyQueue = [];
const MAX_HISTORY_SIZE = 10; // Keep track of the last 10 game turns
let currentOrchestratorText = null; // The full text response from the orchestrator for the current turn
let currentUiJson = null;
let currentNotes = {};
let currentSubjectId = "";
let isExplicitMode = false; // Default mode
let isLoading = false;
let apiKeyLocked = false;
let localGameStateSnapshot = null; // To store local state when viewing remote state
let llmCallHistory = []; // For the debug panel

// --- Spinner State ---
let isSpinnerRunning = false;
let spinnerCompletionCallback = null;
let spinnerAngle = 0;
let spinnerVelocity = 0;
let lastSpinnerFrameTime = 0;
const FRICTION = 0.99;
const MIN_SPINNER_VELOCITY = 0.005;

// --- Minigame State ---
let minigameActive = false;
let minigameCompletionCallback = null;
let playerMove = null;
let partnerMove = null;
let minigameRound = 1;
let lastMinigameWinner = null;
let player1IsInitiator = true;
let minigameActionData = null; // To hold LLM-generated actions
let preloadedMinigameData = null; // To preload the *next* turn's actions
let playerScore = 0;
let partnerScore = 0;

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
const firstDateLoadingModal = document.getElementById('first-date-loading-modal');
const submitButton = document.getElementById('submit-turn');
const apiKeyInput = document.getElementById('apiKeyInput');
const errorDisplay = document.getElementById('error-display');
const modeToggleButton = document.getElementById('modeToggleButton');
const modelToggleButton = document.getElementById('model-toggle-button');
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

// --- Minigame Elements ---
const minigameModal = document.getElementById('minigame-modal');
const minigameTitle = document.getElementById('minigame-title');
const minigameSubtitle = document.getElementById('minigame-subtitle');
const playerScoreDisplay = document.getElementById('player-score');
const partnerScoreDisplay = document.getElementById('partner-score');
const roundResultDisplay = document.getElementById('minigame-round-result');
const graphicalResultDisplay = document.getElementById('minigame-graphical-result');
const resultImage = document.getElementById('result-image');
const resultNarrative = document.getElementById('result-narrative');

const initiatorControls = document.getElementById('initiator-controls');
const receiverControls = document.getElementById('receiver-controls');
const initiatorKissButton = document.getElementById('initiator-kiss-button');
const initiatorHoldHandsButton = document.getElementById('initiator-hold-hands-button');
const receiverAcceptButton = document.getElementById('receiver-accept-button');
const receiverLeanAwayButton = document.getElementById('receiver-lean-away-button');
const receiverTeaseButton = document.getElementById('receiver-tease-button');

// --- Spinner Elements ---
const spinnerModal = document.getElementById('spinner-modal');
const spinnerTitle = document.getElementById('spinner-title');
const spinnerWheel = document.getElementById('spinner-wheel');
const spinnerResult = document.getElementById('spinner-result');

// --- Web Audio API Context ---
let audioCtx = null;

// --- Multiplayer State ---
let isDateActive = false;
let currentPartnerId = null;
let sceneSelections = new Map();
let amIPlayer1 = false;
let turnPackages = new Map(); // To aggregate full turn packages (actions + analysis)
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
        playerA_analysis,
        playerB_analysis,
        isExplicit = false,
        isFirstTurn = false,
        minigameWinner = null,
        history = []
    } = turnData;

    const activeAddendum = isExplicit ? `\n\n---\n${geemsPrompts.masturbationModeAddendum}\n---\n` : "";
    let minigameAddendum = '';
    if (minigameWinner) {
        const winner = (minigameWinner === 'player') ? 'Player A' : 'Player B';
        const loser = (winner === 'Player A') ? 'Player B' : 'Player A';
        minigameAddendum = `\n\n---\nMINIGAME RESULT\n---\nThe pre-turn minigame was won by ${winner}. The loser was ${loser}. You MUST incorporate this result into the turn. Reward the winner with a small advantage, a moment of good luck, or a positive comment from their partner. You MUST punish the loser with a small disadvantage, an embarrassing moment, or a teasing comment from Dr. Gemini. Be creative and subtle.`;
    }

    let prompt;

    switch (promptType) {
        case 'orchestrator':
            prompt = geemsPrompts.orchestrator;
            if (isFirstTurn) {
                prompt += geemsPrompts.firstrun_addendum;
            }

            if (history && history.length > 0) {
                const historyString = history.map((turn, index) => {
                    let notes = "Notes not available in history for this turn.";
                    try {
                        const actionsObj = JSON.parse(turn.actions);
                        if (actionsObj && actionsObj.notes) {
                            notes = actionsObj.notes;
                        }
                    } catch (e) {
                        console.warn(`Could not parse notes from history item #${index}`, e);
                    }

                    return `Turn ${history.length - index} ago:
- Orchestrator Output (that generated the turn):
\`\`\`
${turn.orchestratorText || "Orchestrator text not available for this turn."}
\`\`\`
- Player-Facing UI (that the player saw):
\`\`\`json
${turn.ui}
\`\`\`
- Player Actions Taken (in response to the UI):
\`\`\`json
${turn.actions}
\`\`\`
- Dr. Gemini's Notes (at the end of the turn):
\`\`\`markdown
${notes}
\`\`\`
`
                }).join('\n\n---\n\n');
                prompt += `\n\n---\nCONTEXT: LAST ${history.length} TURNS (Most recent first)\n---\n${historyString}`;
            }

            prompt += `\n\n---\nLATEST TURN DATA (with Pre-Analysis)\n---\n`;
            prompt += `player_input_A: ${JSON.stringify(playerA_actions)}\n`;
            // The analysis object contains the full, updated clinical report which serves as the new notes.
            prompt += `player_analysis_A: \`\`\`json\n${JSON.stringify(playerA_analysis, null, 2)}\n\`\`\`\n\n`;
            prompt += `player_input_B: ${JSON.stringify(playerB_actions)}\n`;
            prompt += `player_analysis_B: \`\`\`json\n${JSON.stringify(playerB_analysis, null, 2)}\n\`\`\`\n`;
            prompt += activeAddendum;
            prompt += minigameAddendum;
            prompt += `\n--- Generate instructions for both players based on the above. ---`;

            if (isFirstTurn) console.log("Generated First Turn Orchestrator Prompt.");
            else console.log("Generated Orchestrator Prompt with pre-analyzed data.");
            break;

        default:
            throw new Error(`Unknown prompt type: ${promptType}`);
    }

    return prompt;
}

/** Saves the current essential game state to local storage. */
function autoSaveGameState() {
    if (!apiKeyLocked) return;
    // Removed the check for currentUiJson to allow saving state even before the first turn.
    const rawApiKey = apiKeyInput.value.trim();
    if (!rawApiKey) return;
    try {
        const stateToSave = {
            encodedApiKey: encodeApiKey(rawApiKey),
            currentUiJson: currentUiJson,
            historyQueue: historyQueue,
            isExplicitMode: isExplicitMode,
            currentModelIndex: currentModelIndex,
            // --- New additions for reconnection ---
            isDateActive: isDateActive,
            currentPartnerId: currentPartnerId, // This is the Room ID of the partner
            amIPlayer1: amIPlayer1,
            isDateExplicit: isDateExplicit,
            // We also need to know the partner's master ID to find them across rooms
            currentPartnerMasterId: isDateActive ? MPLib.getRoomConnections()?.get(currentPartnerId)?.metadata?.masterId : null
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        console.log("Game state auto-saved.", stateToSave);
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
        const previousTurnData = {
            ui: JSON.stringify(currentUiJson),
            actions: playerActionsJson || "{}",
            orchestratorText: currentOrchestratorText || "" // Add the captured orchestrator text
        };
        const isDuplicate = historyQueue.some(item => JSON.stringify(item) === JSON.stringify(previousTurnData));
        if (isDuplicate) {
            console.log("Duplicate turn data detected, not adding to history queue.");
            return;
        }
        if (historyQueue.length >= MAX_HISTORY_SIZE) {
            historyQueue.shift();
        }
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
        // Use a robust regex that accepts the new separator or falls back to the old one.
        const parts = orchestratorText.split(/\n?%%%NEXT_SECTION%%%\n?|\n?---\|\|\|---\n?/).filter(p => p.trim() !== '');
        if (parts.length < 3) { // Check for at least 3 parts, as there might be empty strings from the split.
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

function checkForTurnPackages() {
    const requiredSubmissions = 2;
    const roomConnections = MPLib.getRoomConnections();

    // Ensure we are in a 2-player date before proceeding.
    if (!isDateActive || (roomConnections && roomConnections.size + 1 !== requiredSubmissions)) {
        return;
    }

    if (turnPackages.size < requiredSubmissions) {
        console.log(`Have ${turnPackages.size}/${requiredSubmissions} turn packages. Waiting...`);
        return;
    }

    console.log("All turn packages received. Initiating next turn generation.");

    // Player 1 is responsible for orchestrating the next turn.
    if (amIPlayer1) {
        const myRoomId = MPLib.getLocalRoomId();
        // Find the partner's ID from the live connections.
        const partnerRoomId = Array.from(roomConnections.keys()).find(id => id !== myRoomId);

        if (!partnerRoomId) {
            showError("FATAL: Could not find partner's ID. Aborting turn.");
            turnPackages.clear();
            setLoading(false);
            return;
        }

        const packageA = turnPackages.get(myRoomId);
        const packageB = turnPackages.get(partnerRoomId);

        if (!packageA || !packageB) {
            showError("FATAL: Could not map turn packages to players. Aborting turn.");
            turnPackages.clear();
            setLoading(false);
            return;
        }

        // The orchestrator now receives the pre-analyzed reports.
        const turnData = {
            playerA_actions: packageA.actions,
            playerB_actions: packageB.actions,
            playerA_analysis: packageA.analysis,
            playerB_analysis: packageB.analysis,
            isExplicit: isDateExplicit,
            history: historyQueue,
            minigameWinner: lastMinigameWinner // Use winner from the *previous* turn's minigame
        };

        initiateTurnAsPlayer1(turnData);
        turnPackages.clear(); // Clear packages for the next turn

        // Player 1 now delegates the minigame generation to Player 2 to run in parallel,
        // and both players will start the minigame UI immediately.
        if (partnerRoomId) {
            console.log("Delegating minigame generation to Player 2 and starting minigame locally.");
            lastMinigameWinner = null; // Reset for the new game that's about to start.
            MPLib.sendDirectToRoomPeer(partnerRoomId, { type: 'generate_minigame_data' });
            startMinigame(minigameCompletionHandler); // P1 starts their minigame UI immediately.
        } else {
            console.error("Could not find partner to delegate minigame generation.");
            // Handle error case, maybe by P1 generating it anyway? For now, just log.
        }
    }
}


async function initiateSinglePlayerTurn(turnData) {
    console.log("Initiating single-player turn with pre-analyzed data...");
    setLoading(true, true);

    try {
        // The turnData object is now constructed in the submitButton event listener,
        // containing the pre-analyzed report.
        const orchestratorPrompt = constructPrompt('orchestrator', turnData);
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");
        currentOrchestratorText = orchestratorText; // Capture the orchestrator output

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

    try {
        const orchestratorPrompt = constructPrompt('orchestrator', turnData);
        // The orchestrator now returns a single plain text block
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");
        currentOrchestratorText = orchestratorText; // Capture the orchestrator output

        // Now that the orchestrator call is complete, the wait is over. End the minigame.
        endMinigame();

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
 * A wrapper for the Gemini API call that includes retry logic, model preference, and primary key fallback.
 */
async function callGeminiApiWithRetry(prompt, responseMimeType = "application/json", preferredModel = null) {
    let apiKey = getPrimaryApiKey(); // Tries the default key first.
    if (!apiKey) {
        apiKey = apiKeyInput.value.trim();
    }

    if (!apiKey) {
        showError("API Key is missing. Please enter your own key to continue.");
        throw new Error("API Key is missing.");
    }

    let lastError = null;
    const modelsToTry = [];

    if (preferredModel) {
        // If a preferred model is given, try only that one.
        modelsToTry.push(preferredModel);
    } else {
        // Otherwise, create a prioritized list starting with the user's selected model.
        for (let i = 0; i < AVAILABLE_MODELS.length; i++) {
            const modelIndex = (currentModelIndex + i) % AVAILABLE_MODELS.length;
            modelsToTry.push(AVAILABLE_MODELS[modelIndex]);
        }
    }

    console.log("Models to try in order:", modelsToTry);

    for (const modelName of modelsToTry) {
        console.log(`Attempting API call with model: ${modelName}`);
        try {
            const responseText = await callRealGeminiAPI(apiKey, prompt, modelName, responseMimeType);
            console.log(`API call successful with model: ${modelName}`);

            // If this wasn't a preferred model call, update the current index to remember the last successful model.
            if (!preferredModel) {
                currentModelIndex = AVAILABLE_MODELS.indexOf(modelName);
                updateModelToggleVisuals();
            }
            return responseText;
        } catch (error) {
            console.warn(`API call failed for model ${modelName}. Error:`, error.message);
            lastError = error; // Store the last error, so we can throw it if all attempts fail.
        }
    }

    // This part is reached if all attempts in the loop fail.
    console.error("All API call attempts failed.");

    // Special handling for when the primary (default) API key fails.
    const primaryKey = getPrimaryApiKey();
    // A 400 error is often "API key not valid".
    if (primaryKey && apiKey === primaryKey && lastError && (lastError.message.includes('429') || lastError.message.includes('API_KEY_INVALID') || lastError.message.includes('400'))) {
        console.warn("Primary API key has failed. Switching to user input.");
        hasPrimaryApiKeyFailed = true;

        // Update the UI to allow the user to enter their own key.
        apiKeyInput.disabled = false;
        apiKeyInput.value = ''; // Clear the failed key
        apiKeyInput.placeholder = 'Enter your Gemini API key';
        apiKeyInput.focus();
        localStorage.removeItem('sparksync_apiKey'); // Prevent auto-login with the failed key

        const userMessage = "The default API key is invalid or has expired. Please enter your own key to continue.";
        showError(userMessage);
        throw new Error(userMessage);
    }

    // For any other final error, throw the last one we recorded.
    throw lastError || new Error(`Failed to get valid response from AI after trying all available models.`);
}

/**
 * Calls the local analyzer LLM to get a report on a player's actions.
 * @param {object} actions - The JSON object of actions from the turn.
 * @param {string} notes - The previous turn's notes for the player.
 * @returns {Promise<object|null>} A promise that resolves to the analysis object { green_flags, red_flags, clinical_report }.
 */
async function analyzePlayerActions(actions, notes) {
    console.log("Analyzing player actions locally...");
    try {
        const prompt = `${analyzer_prompt}\n\n## Previous Notes:\n${notes}\n\n## Current Turn Actions:\n${JSON.stringify(actions, null, 2)}`;

        // This is a complex reasoning task, so it uses the main Pro/Flash toggle and not a "lite" model.
        const responseJson = await callGeminiApiWithRetry(prompt, "application/json");
        const analysis = JSON.parse(responseJson);

        // Validate the response
        if (analysis && typeof analysis.green_flags === 'string' && typeof analysis.red_flags === 'string' && typeof analysis.clinical_report === 'string') {
            console.log("Successfully received player action analysis.");
            return analysis;
        } else {
            console.warn("Player action analysis response was not in the expected format:", analysis);
            // Return a default error object to prevent crashes downstream
            return {
                green_flags: "Analysis failed.",
                red_flags: "Analysis failed.",
                clinical_report: "Could not generate clinical report due to a formatting error."
            };
        }
    } catch (error) {
        console.error("Failed to get player action analysis from LLM:", error);
        showError("Failed to analyze player actions.");
        return null;
    }
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
            const interstitialWheel = document.getElementById('interstitial-spinner-wheel');
            if(interstitialWheel) {
                 populateSpinner(interstitialWheel, 'prizes');
            }

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

function updateModelToggleVisuals() {
    if (!modelToggleButton) return;
    // Index 0 is Pro (Quality), Index 1 is Flash (Speed)
    if (currentModelIndex === 0) {
        modelToggleButton.textContent = 'Mode: Quality';
    } else {
        modelToggleButton.textContent = 'Mode: Speed';
    }
}

function toggleModel() {
    currentModelIndex = (currentModelIndex + 1) % AVAILABLE_MODELS.length;
    console.log(`Model switched to: ${AVAILABLE_MODELS[currentModelIndex]}`);
    updateModelToggleVisuals();
    autoSaveGameState();
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

    // --- Reconnection Logic ---
    if (reconnectionPartnerMasterId) {
        console.log("Room connected, now checking for reconnection partner...");
        const connections = MPLib.getRoomConnections();
        let partnerFound = false;
        for (const [roomId, conn] of connections.entries()) {
            if (conn.metadata?.masterId === reconnectionPartnerMasterId) {
                console.log(`Reconnection partner found! New Room ID: ${roomId}`);
                currentPartnerId = roomId; // This is the new room ID for the partner
                partnerFound = true;
                break;
            }
        }

        if (partnerFound) {
            showNotification("Successfully reconnected to your partner!", "success");
            const savedState = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY));
            restoreDateState(savedState); // Use the new comprehensive function
        } else {
            console.log("Reconnection partner not found in the current room. The date has ended.");
            showError("Your previous partner could not be found. The date has ended.");
            isDateActive = false;
            autoSaveGameState(); // Persist the ended date
            renderLobby(); // Go back to the lobby
        }
        // Reset the global variable to prevent this logic from running again
        reconnectionPartnerMasterId = null;
    }
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

        // Reset date state variables FIRST
        isDateActive = false;
        currentPartnerId = null;
        amIPlayer1 = false;
        turnPackages.clear();

        // Persist the fact that the date has ended. This will now save with isDateActive = false.
        autoSaveGameState();

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

// --- Minigame Functions ---

async function startMinigame(onComplete) {
    console.log("Starting 'Make a Move' Minigame UI...");
    minigameActive = true;
    minigameCompletionCallback = onComplete;
    minigameRound = 1;
    playerMove = null;
    partnerMove = null;
    playerScore = 0;
    partnerScore = 0;
    player1IsInitiator = true; // Player 1 always starts as the initiator
    minigameActionData = null; // Clear old data
    preloadedMinigameData = null; // Clear old data

    if (minigameModal) minigameModal.style.display = 'flex';
    if (roundResultDisplay) roundResultDisplay.innerHTML = '';
    if (graphicalResultDisplay) graphicalResultDisplay.classList.add('hidden');

    const previousResultDisplay = document.getElementById('minigame-previous-result');
    if (previousResultDisplay) {
        previousResultDisplay.innerHTML = '';
        previousResultDisplay.classList.add('hidden');
    }
    updateScoreboard();

    // The UI is now symmetrical. Both players see a loading state.
    // Player 2 is responsible for generating and broadcasting the data.
    minigameTitle.textContent = "Make a Move";
    roundResultDisplay.textContent = "Waiting for game data to be generated...";

    // Hide controls until data arrives
    initiatorControls.style.display = 'none';
    receiverControls.style.display = 'none';
}

function handlePlayerMove(move) {
    if (!playerMove) {
        playerMove = move;
        setMoveButtonsDisabled(true);
        // Show the player's selection
        const moveText = move.replace(/_/g, ' ');
        roundResultDisplay.innerHTML = `You chose to <strong class="text-indigo-600">${moveText}</strong>. Waiting for partner...`;
        MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'minigame_move', payload: { move: move } });
        checkForRoundCompletion();
    }
}

function checkForRoundCompletion() {
    if (playerMove && partnerMove) {
        const iAmInitiator = (amIPlayer1 && player1IsInitiator) || (!amIPlayer1 && !player1IsInitiator);

        let initiatorMove, receiverMove;
        if (iAmInitiator) {
            initiatorMove = playerMove;
            receiverMove = partnerMove;
        } else {
            initiatorMove = partnerMove;
            receiverMove = playerMove;
        }

        console.log(`Round ${minigameRound} complete. Initiator: ${initiatorMove}, Receiver: ${receiverMove}`);

        const yourMoveText = playerMove.replace(/_/g, ' ');
        const partnerMoveText = partnerMove.replace(/_/g, ' ');
        roundResultDisplay.innerHTML = `You chose <strong class="text-indigo-600">${yourMoveText}</strong>. Your partner chose <strong class="text-pink-600">${partnerMoveText}</strong>.<br>Figuring out what happens...`;

        // Wait a moment before revealing the winner
        setTimeout(async () => {
            try {
                const context = historyQueue.length > 0 ?
                    JSON.parse(historyQueue[historyQueue.length - 1].ui).find(el => el.name === 'narrative')?.value || "A date is happening."
                    : "It's the beginning of the date.";

                const outcome = await getMinigameOutcome(initiatorMove, receiverMove, context, isDateExplicit, callGeminiApiWithRetry);

                if (outcome && resultImage && resultNarrative && graphicalResultDisplay) {
                    resultNarrative.textContent = outcome.narrative;
                    const randomSeed = Math.floor(Math.random() * 65536);
                    resultImage.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(outcome.image_prompt)}?nologo=true&safe=false&seed=${randomSeed}`;
                    graphicalResultDisplay.classList.remove('hidden');

                    let roundMessage = "The outcome is a draw!";
                    const winner = outcome.winner;
                    if (winner && winner !== 'draw') {
                        const iAmWinner = (iAmInitiator && winner === 'initiator') || (!iAmInitiator && winner === 'receiver');
                        if (iAmWinner) {
                            playerScore++;
                            roundMessage = "You won the moment!";
                        } else {
                            partnerScore++;
                            roundMessage = "Your partner won the moment.";
                        }
                    }
                    roundResultDisplay.innerHTML = `You chose <strong class="text-indigo-600">${yourMoveText}</strong>. Your partner chose <strong class="text-pink-600">${partnerMoveText}</strong>. <br><strong>${roundMessage}</strong>`;
                    updateScoreboard();
                } else {
                     roundResultDisplay.innerHTML += `<br>Could not determine the outcome. Let's call it a draw.`;
                }

                minigameRound++;
                player1IsInitiator = !player1IsInitiator;
                setTimeout(resetRoundUI, 8000);

            } catch (e) {
                console.error("Could not generate round outcome:", e);
                roundResultDisplay.innerHTML += `<br>An error occurred. Let's call it a draw and continue.`;
                minigameRound++;
                player1IsInitiator = !player1IsInitiator;
                setTimeout(resetRoundUI, 5000);
            }
        }, 2500);
    }
}


function endMinigame() {
    minigameActive = false;
    setMoveButtonsDisabled(true);

    let finalWinner = 'draw';
    if (playerScore > partnerScore) {
        finalWinner = 'player';
    } else if (partnerScore > playerScore) {
        finalWinner = 'partner';
    }

    if (minigameModal) {
        minigameModal.style.opacity = '0';
        setTimeout(() => {
            minigameModal.style.display = 'none';
            minigameModal.style.opacity = '1';
            if (minigameCompletionCallback) {
                minigameCompletionCallback(finalWinner);
            }
        }, 500);
    }
}
function updateScoreboard() {
    if(playerScoreDisplay && partnerScoreDisplay){
        playerScoreDisplay.textContent = playerScore;
        partnerScoreDisplay.textContent = partnerScore;
    }
}

function resetRoundUI() {
    playerMove = null;
    partnerMove = null;

    const previousResultDisplay = document.getElementById('minigame-previous-result');
    // If the graphical result was shown for the round that just ended...
    if (graphicalResultDisplay && !graphicalResultDisplay.classList.contains('hidden')) {
        // ...move its content to the "previous result" div and show it.
        previousResultDisplay.innerHTML = '<h4>Previous Round:</h4>' + graphicalResultDisplay.innerHTML;
        previousResultDisplay.classList.remove('hidden');

        // NOW, clear the graphical result display and hide it.
        graphicalResultDisplay.innerHTML = '';
        graphicalResultDisplay.classList.add('hidden');
    }


    if (!minigameActionData) {
        console.warn("resetRoundUI called without minigameActionData.");
        roundResultDisplay.textContent = "Loading minigame...";
        return;
    }

    // Use preloaded data for the next round if it exists
    if (minigameRound > 1 && preloadedMinigameData) {
        console.log("Switching to preloaded minigame data for the new round.");
        minigameActionData = preloadedMinigameData;
        preloadedMinigameData = null; // Mark as used

        // Asynchronously preload data for the *next* round
        if (amIPlayer1) {
            getMinigameActions(isDateExplicit, callGeminiApiWithRetry).then(preloadData => {
                preloadedMinigameData = preloadData;
                MPLib.broadcastToRoom({ type: 'minigame_preload_data', payload: preloadData });
                console.log("Preloaded data for next round and sent to partner.");
            });
        }
    }


    const iAmInitiator = (amIPlayer1 && player1IsInitiator) || (!amIPlayer1 && !player1IsInitiator);
    const actionsToShow = iAmInitiator ? minigameActionData.initiator_actions : minigameActionData.receiver_actions;
    const controlsDiv = iAmInitiator ? initiatorControls : receiverControls;
    const otherControlsDiv = iAmInitiator ? receiverControls : initiatorControls;

    // Clear existing buttons
    const buttonContainer = controlsDiv.querySelector('.flex');
    if (buttonContainer) {
        buttonContainer.innerHTML = '';
    }

    // Shuffle and pick 4 actions
    const selectedActions = actionsToShow.sort(() => 0.5 - Math.random()).slice(0, 4);

    selectedActions.forEach(action => {
        const button = document.createElement('button');
        button.className = 'geems-button minigame-button';
        button.textContent = action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
        button.onclick = () => handlePlayerMove(action);
        if (buttonContainer) {
            buttonContainer.appendChild(button);
        }
    });


    if (iAmInitiator) {
        roundResultDisplay.textContent = `Round ${minigameRound}: You are the Initiator. Make your move...`;
        controlsDiv.style.display = 'block';
        otherControlsDiv.style.display = 'none';
    } else {
        roundResultDisplay.textContent = `Round ${minigameRound}: You are the Receiver. Respond to your partner...`;
        controlsDiv.style.display = 'block';
        otherControlsDiv.style.display = 'none';
    }

    setMoveButtonsDisabled(false); // This function will now disable all buttons in both containers
}

function setMoveButtonsDisabled(disabled) {
    // Select all buttons within the minigame controls
    const buttons = document.querySelectorAll('#initiator-controls .minigame-button, #receiver-controls .minigame-button');
    buttons.forEach(button => {
        button.disabled = disabled;
    });
}

function minigameCompletionHandler(winner) {
    // The winner is 'player' if the local player won, 'partner' if the remote player won.
    // The orchestrator expects to know who Player A and Player B are.
    if (winner === 'draw') {
        lastMinigameWinner = null;
    } else if (winner === 'player') {
        lastMinigameWinner = amIPlayer1 ? 'playerA' : 'playerB';
    } else if (winner === 'partner') {
        lastMinigameWinner = amIPlayer1 ? 'playerB' : 'playerA';
    }
    console.log(`Minigame complete. Stored winner for next turn: ${lastMinigameWinner}`);
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
            break;

        case 'scene_selection_submission':
            console.log(`Received scene selections from ${senderId.slice(-6)}`);
            if (isDateActive) {
                sceneSelections.set(senderId, data.payload);
                checkForSceneSelectionCompletion();
            }
            break;

        case 'spinner_state_update':
            // This is now handled by a dedicated function for clarity
            if (data.payload && data.payload.spinners) {
                handleSpinnerStateUpdate(data.payload.spinners);
            }
            break;
        // The 'spinner_result' case is now obsolete, as the final result is
        // part of the continuous state update. P1 calls endSpinner directly,
        // and P2 calls it when all spinners stop spinning in the state update.

        case 'minigame_data':
            // This is now received by Player 1 after Player 2 generates and broadcasts it.
            if (minigameActive && amIPlayer1) {
                minigameActionData = data.payload;
                console.log("Player 1 received minigame data broadcast.", minigameActionData);
                resetRoundUI(); // Now that we have data, setup the UI
            }
            break;

        case 'minigame_preload_data':
            if (minigameActive && !amIPlayer1) {
                preloadedMinigameData = data.payload;
                console.log("Received preloaded minigame data for next round.", preloadedMinigameData);
            }
            break;

        case 'minigame_move':
            if (minigameActive && !partnerMove) {
                partnerMove = data.payload.move;
                console.log(`Partner chose ${partnerMove}`);
                checkForRoundCompletion();
            }
            const button = document.querySelector(`.propose-date-button[data-peer-id="${senderId}"]`);
            if (button) {
                button.disabled = false;
                button.textContent = 'Propose Date';
            }
            break;

        case 'turn_submission':
            console.log(`Received turn submission package from ${senderId.slice(-6)}`);
            if (isDateActive) {
                // The payload is the complete package (actions + analysis)
                const fullPackage = data.payload;
                // Use the room ID as the key
                turnPackages.set(senderId, fullPackage);
                checkForTurnPackages();
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
            currentOrchestratorText = data.payload; // Capture the orchestrator output
            if (isDateActive && !amIPlayer1) {
                 // Player 2 receives the orchestrator output.
                 // The main turn generation is complete, so the minigame can end.
                endMinigame();
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
        case 'scene_options':
            // Player 2 receives the options from Player 1
            if (!amIPlayer1) {
                console.log("Received scene options from Player 1:", data.payload);
                startSceneSelection(data.payload);
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
        case 'generate_minigame_data':
            // This message is sent BY Player 1 TO Player 2.
            // Therefore, only Player 2 should act on it.
            if (!amIPlayer1) {
                console.log("Received delegation from Player 1. Starting minigame UI and generating data.");
                // Player 2 starts the minigame UI immediately, just like Player 1.
                startMinigame(minigameCompletionHandler);

                getMinigameActions(isDateExplicit, callGeminiApiWithRetry).then(data => {
                    if (data) {
                        console.log("Minigame data generated by Player 2, broadcasting to room...");
                        // Broadcast the generated data for both players to use.
                        MPLib.broadcastToRoom({ type: 'minigame_data', payload: data });

                        // Manually process the data locally for Player 2, since broadcast doesn't send to self.
                        minigameActionData = data;
                        console.log("Player 2 is processing generated minigame data locally.");
                        resetRoundUI();

                        // Asynchronously preload data for the next round
                        getMinigameActions(isDateExplicit, callGeminiApiWithRetry).then(preloadData => {
                            preloadedMinigameData = preloadData;
                            // Only Player 2 needs to know about this. No need to broadcast.
                            console.log("Preloaded data for next minigame round.");
                        });

                    } else {
                        showError("Could not generate minigame actions as Player 2.");
                    }
                }).catch(err => {
                    console.error("Error generating minigame actions as Player 2:", err);
                    showError("Failed to generate minigame actions due to an API error.");
                });
            }
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
submitButton.addEventListener('click', async () => {
    if (isLoading) return;
    submitButton.disabled = true;

    const playerActionsJson = collectInputState();
    updateHistoryQueue(playerActionsJson);
    const playerActions = JSON.parse(playerActionsJson);
    updateLocalProfileFromTurn(playerActions);

    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.textContent = 'Analyzing actions...';
    setLoading(true, true);

    // Get the previous notes for the current player.
    const lastTurnHistory = historyQueue.length > 1 ? historyQueue[historyQueue.length - 2] : null;
    let previousNotes = "This is the first turn.";
    if (lastTurnHistory && lastTurnHistory.actions) {
        try {
            const lastActions = JSON.parse(lastTurnHistory.actions);
            if(lastActions.notes) previousNotes = lastActions.notes;
        } catch(e) { console.warn("Could not parse previous notes."); }
    }


    // Step 1: Analyze actions locally
    const analysis = await analyzePlayerActions(playerActions, previousNotes);
    if (!analysis) {
        showError("Could not analyze your actions. Please try submitting again.");
        setLoading(false);
        submitButton.disabled = false;
        return;
    }

     // Step 2: Create the full "turn package"
    const turnPackage = {
        actions: playerActions,
        analysis: analysis
    };

    if (isDateActive) {
        // --- Symmetrical Two-Player Date Logic ---
        const myRoomId = MPLib.getLocalRoomId();
        if (myRoomId) {
            turnPackages.set(myRoomId, turnPackage);
            console.log(`Locally recorded turn package for ${myRoomId.slice(-6)}`);
        } else {
            showError("A local error occurred. Could not submit turn package.");
            setLoading(false);
            submitButton.disabled = false;
            return;
        }

        if(loadingText) loadingText.textContent = 'Waiting for partner...';
        showNotification("Actions analyzed and submitted. Waiting for partner...", "info");

        // Broadcast the complete package to everyone in the room.
        MPLib.broadcastToRoom({ type: 'turn_submission', payload: turnPackage });

        checkForTurnPackages();

    } else {
        // --- Single-Player Logic ---
        console.log("Submit button clicked (single-player mode).");
        const turnData = {
            playerA_actions: playerActions,
            playerB_actions: { turn: playerActions.turn, action: "The other player is an AI.", notes: "No notes for AI." }, // Dummy data for player B
            playerA_analysis: analysis,
            playerB_analysis: { green_flags: "N/A", red_flags: "N/A", clinical_report: "The other player is an AI and was not analyzed." }, // Dummy analysis for B
            isExplicit: isExplicitMode,
            history: historyQueue.slice(0, -1) // Pass history *before* this turn
        };
        initiateSinglePlayerTurn(turnData);
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

if (modelToggleButton) {
    modelToggleButton.addEventListener('click', () => {
        if (isLoading) return;
        toggleModel();
    });
}

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
                button.className = 'geems-button';
                button.dataset.masterId = player.id;

                // Check if there's a restorable game with this player
                const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
                let savedState = null;
                if (savedStateJSON) {
                    try { savedState = JSON.parse(savedStateJSON); } catch (e) {}
                }

                if (savedState && savedState.isDateActive && savedState.currentPartnerMasterId === player.id) {
                    button.textContent = 'Resume Date';
                    button.classList.add('resume-date-button');
                    button.onclick = (event) => {
                        const targetMasterId = event.target.dataset.masterId;
                        console.log(`Attempting to resume date with ${targetMasterId}`);
                        const roomConnection = Array.from(MPLib.getRoomConnections().values()).find(conn => conn.metadata?.masterId === targetMasterId);
                        if (roomConnection) {
                            currentPartnerId = roomConnection.peer; // Set the partner's current room ID
                            restoreDateState(savedState); // Use the new comprehensive function
                        } else {
                            showError("Could not find that player. They may have left the room.");
                        }
                    };
                } else {
                    button.textContent = 'Propose Date';
                    button.classList.add('propose-date-button');
                    button.onclick = (event) => {
                        const targetMasterId = event.target.dataset.masterId;
                        const roomConnection = Array.from(MPLib.getRoomConnections().values()).find(conn => conn.metadata?.masterId === targetMasterId);

                        if (roomConnection) {
                            const targetRoomId = roomConnection.peer;
                            console.log(`Proposing date to masterId ${targetMasterId.slice(-6)} (via roomId ${targetRoomId.slice(-6)})`);
                            const payload = { proposerExplicitMode: isExplicitMode };
                            MPLib.sendDirectToRoomPeer(targetRoomId, { type: 'date_proposal', payload: payload });
                            event.target.disabled = true;
                            event.target.textContent = 'Request Sent';
                        } else {
                            showError("Could not find the player to send the proposal. They may have disconnected.");
                        }
                    };
                }

                if (!player.roomConnection || !player.roomConnection.open) {
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
async function startNewDate(partnerId, iAmPlayer1) {
    console.log(`Starting new date with ${partnerId}. Am I Player 1? ${iAmPlayer1}`);

    isDateActive = true;
    currentPartnerId = partnerId;
    amIPlayer1 = iAmPlayer1;
    turnPackages.clear();
    sceneSelections.clear();

    // Save the initial state of the new date
    autoSaveGameState();

    // Hide lobby, show game
    const directoryContainer = document.getElementById('global-directory-container');
    if(directoryContainer) directoryContainer.style.display = 'none';
    if(lobbyContainer) lobbyContainer.style.display = 'none';
    if(gameWrapper) gameWrapper.style.display = 'block';

    // Player 1 generates the scene options and shows a loading modal.
    // Player 2 just waits.
    if (amIPlayer1) {
        if (firstDateLoadingModal) firstDateLoadingModal.style.display = 'flex';
        try {
            const dynamicOptions = await getDynamicSceneOptions(isDateExplicit, callGeminiApiWithRetry);
            // When P1 is done, they broadcast the options to P2.
            MPLib.broadcastToRoom({ type: 'scene_options', payload: dynamicOptions });
            startSceneSelection(dynamicOptions);
        } catch (error) {
            console.error("Error generating dynamic scene options:", error);
            // If the error is a key failure, the retry logic has already updated the UI.
            // We just need to show the error and *not* fall back, halting the date.
            if (error.message && (error.message.includes('The default API key is invalid') || error.message.includes('API Key is missing'))) {
                showError(error.message);
            } else {
                // For other errors (e.g., network), fallback to static options is acceptable.
                showError("Could not generate scene options. Falling back to defaults.");
                startSceneSelection(sceneFeatures);
            }
        } finally {
            if (firstDateLoadingModal) firstDateLoadingModal.style.display = 'none';
        }
    } else {
        // Player 2 shows a simple waiting message, but not a modal.
        uiContainer.innerHTML = `<div class="text-center p-8"><h2>Waiting for Player 1 to set the scene...</h2><p>The first date options will appear here shortly.</p></div>`;
    }
}

function startSceneSelection(options) {
    console.log("Starting scene selection with 3 categories...");
    uiContainer.innerHTML = `<div class="text-center p-8"><h2>Let's set the scene...</h2><p>Choose some elements for your first date. Your choices will be combined with your partner's to create the setting.</p></div>`;

    const selectionGrid = document.createElement('div');
    selectionGrid.className = 'scene-selection-grid';

    // Use dynamic options, but fall back to static if they are missing
    const locations = options?.locations || sceneFeatures.locations;
    const vibes = options?.vibes || sceneFeatures.vibes;
    const wildcards = options?.wildcards || sceneFeatures.wildcards;

    // Create columns for each category
    const locationColumn = document.createElement('div');
    locationColumn.innerHTML = '<h3>Locations</h3>';
    locations.slice(0, 5).forEach(loc => locationColumn.appendChild(createSelectionCheckbox('location', loc)));

    const vibeColumn = document.createElement('div');
    vibeColumn.innerHTML = '<h3>Vibes</h3>';
    vibes.slice(0, 5).forEach(vibe => vibeColumn.appendChild(createSelectionCheckbox('vibe', vibe)));

    const wildcardColumn = document.createElement('div');
    wildcardColumn.innerHTML = '<h3>Wildcards</h3>';
    wildcards.slice(0, 5).forEach(wc => wildcardColumn.appendChild(createSelectionCheckbox('wildcard', wc)));

    selectionGrid.append(locationColumn, vibeColumn, wildcardColumn);
    uiContainer.appendChild(selectionGrid);

    const submitSelectionsButton = document.createElement('button');
    submitSelectionsButton.id = 'submit-scene-selections';
    submitSelectionsButton.className = 'geems-button mt-4';
    submitSelectionsButton.textContent = 'Submit Selections';
    uiContainer.appendChild(submitSelectionsButton);

    submitSelectionsButton.onclick = () => {
        const selections = { location: [], vibe: [], wildcard: [] };
        uiContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
            const category = checkbox.dataset.category;
            const label = checkbox.parentElement.querySelector('label').textContent;
            if (selections[category]) {
                selections[category].push(label);
            }
        });

        console.log("My scene selections:", selections);
        MPLib.broadcastToRoom({ type: 'scene_selection_submission', payload: selections });

        const myRoomId = MPLib.getLocalRoomId();
        sceneSelections.set(myRoomId, selections);

        uiContainer.innerHTML = `<div class="text-center p-8"><h2>Selections submitted.</h2><p>Waiting for your partner...</p></div>`;
        checkForSceneSelectionCompletion();
    };
}

function createSelectionCheckbox(category, label) {
    const wrapper = document.createElement('div');
    wrapper.className = 'geems-checkbox-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `${category}_${label.replace(/\s+/g, '_')}`;
    input.name = `${category}_${label.replace(/\s+/g, '_')}`;
    input.dataset.category = category;
    const labelEl = document.createElement('label');
    labelEl.htmlFor = input.id;
    labelEl.textContent = label;
    wrapper.appendChild(input);
    wrapper.appendChild(labelEl);
    return wrapper;
}

function checkForSceneSelectionCompletion() {
    if (sceneSelections.size < 2) {
        return;
    }
    console.log("Both players have submitted scene selections.");

    // Aggregate selections from both players for each category
    const allSelections = { location: [], vibe: [], wildcard: [] };
    for (const selections of sceneSelections.values()) {
        for (const category in selections) {
            if (allSelections[category]) {
                allSelections[category].push(...selections[category]);
            }
        }
    }

    const processCategory = (categoryKey) => {
        const counts = {};
        const sourceArray = allSelections[categoryKey];
        sourceArray.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });

        let weightedItems = Object.entries(counts).map(([text, count]) => ({
            text: text,
            weight: count // count will be 1 for single selection, 2 for agreement
        }));

        if (weightedItems.length === 0) {
            const defaultArray = sceneFeatures[categoryKey + 's'] || sceneFeatures[categoryKey];
            const randomItem = defaultArray[Math.floor(Math.random() * defaultArray.length)];
            weightedItems.push({ text: randomItem, weight: 1 });
            console.log(`No ${categoryKey} selected, adding a random one:`, randomItem);
        }
        return weightedItems;
    };

    const locationItems = processCategory('location');
    const vibeItems = processCategory('vibe');
    const wildcardItems = processCategory('wildcard');

    console.log("Final weighted items for spinners:", {
        locations: locationItems,
        vibes: vibeItems,
        wildcards: wildcardItems
    });

    // Pass the arrays of weighted items to the new startSpinner function
    startSpinner(
        [
            { title: 'Location', items: locationItems },
            { title: 'Vibe', items: vibeItems },
            { title: 'Wildcard', items: wildcardItems }
        ],
        (winningResults) => {
            if (amIPlayer1) {
                // Combine the results into a single scene description
                const winningScene = `${winningResults[0]} with a ${winningResults[1].toLowerCase()} vibe, when suddenly ${winningResults[2].toLowerCase()}.`;
                console.log("Final winning scene:", winningScene);
                fetchFirstTurn(null, winningScene);
            }
        }
    );
}

async function fetchFirstTurn(minigameWinner, scene) {
    console.log(`Fetching first turn. Minigame winner: ${minigameWinner}, Scene: ${scene}`);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
        loadingText.textContent = 'Inventing a new scenario... Please wait.';
    }
    setLoading(true, true); // Use the simple spinner for the first turn

    // Load the local profile to provide context to the AI if it exists.
    const localProfile = getLocalProfile();
    const profileString = `Player A's saved profile: ${JSON.stringify(localProfile)}. If profile data exists, use it when creating the notes and UI. Otherwise, ensure the UI probes for it.`;

    // For the first turn, there are no previous actions. The "analysis" serves as the setup instructions.
    const initialTurnData = {
        playerA_actions: { turn: 0, action: "game_start" },
        playerB_actions: { turn: 0, action: "game_start" },
        playerA_analysis: {
            green_flags: "N/A",
            red_flags: "N/A",
            clinical_report: `This is the very first turn of a new blind date. The scene is: ${scene}. As Player 1, I have arrived first. Please generate a new scene and starting UI for both players. ${profileString}`
        },
        playerB_analysis: {
            green_flags: "N/A",
            red_flags: "N/A",
            clinical_report: `This is the very first turn of a new blind date. The scene is: ${scene}. As Player 2, I am just arriving. Please generate a new scene and starting UI for both players.`
        },
        isExplicit: isDateExplicit,
        minigameWinner: minigameWinner,
        isFirstTurn: true
    };

    // We can now just call the same function used for all subsequent turns.
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

function restoreDateState(savedState) {
    console.log("Restoring full date state...");
    // Restore the underlying application state
    isDateActive = true;
    amIPlayer1 = savedState.amIPlayer1;
    isDateExplicit = savedState.isDateExplicit;
    // The partner's room ID should have been found and set before this function is called.
    // We log here to ensure it's correct.
    console.log(`Restored date state. Partner Room ID: ${currentPartnerId}`);

    // Now, restore the visual part of the game
    restoreGameUI(savedState);
}

function restoreGameUI(savedState) {
    // This function will handle the visual restoration of the game
    if (savedState.currentUiJson) {
        renderUI(savedState.currentUiJson);
        apiKeyLocked = true;
        resetGameButton.disabled = false;
        if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'none';
        if(gameWrapper) gameWrapper.style.display = 'block';
        if(lobbyContainer) lobbyContainer.style.display = 'none';
         const directoryContainer = document.getElementById('global-directory-container');
        if(directoryContainer) directoryContainer.style.display = 'none';

    }
    updateModeButtonVisuals();
    updateModelToggleVisuals();
}


// --- New global for reconnection ---
let reconnectionPartnerMasterId = null;

function loadGameStateFromStorage() {
    const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedStateJSON) {
        try {
            const savedState = JSON.parse(savedStateJSON);
            console.log("Game state loaded from localStorage:", savedState);

            // Restore non-UI state variables first
            currentUiJson = savedState.currentUiJson || null;
            historyQueue = savedState.historyQueue || [];
            isExplicitMode = savedState.isExplicitMode || false;
            currentModelIndex = savedState.currentModelIndex || 0;

            // --- Reconnection Logic ---
            if (savedState.isDateActive && savedState.currentPartnerMasterId) {
                console.log(`Found an active date with partner ${savedState.currentPartnerMasterId}. Will attempt to reconnect.`);
                // Set the global variable to be checked later, when the room is connected.
                reconnectionPartnerMasterId = savedState.currentPartnerMasterId;

                // Pre-load the rest of the date state
                isDateActive = true;
                amIPlayer1 = savedState.amIPlayer1;
                isDateExplicit = savedState.isDateExplicit;
                currentPartnerId = null; // We don't know their new room ID yet

                // Don't render the UI yet. Wait until the connection is confirmed.
                showNotification("Found a previous date. Attempting to reconnect...", "info");
                return; // Wait for MPLib initialization
            }

            // If no active date, restore UI for a non-game state (e.g., if user was in the middle of typing)
            restoreGameUI(savedState);

        } catch (error) {
            console.error("Error loading game state from localStorage:", error);
            localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear corrupted data
        }
    }
}

function initializeGame() {
    console.log("Initializing Flagged with new Master Directory architecture...");
    loadGameStateFromStorage(); // Load saved state first

    // Handle interstitial continue button click
    interstitialContinueButton.addEventListener('click', () => {
        interstitialScreen.style.display = 'none';
        window.scrollTo(0, 0); // Scroll to top
    });

    // Hide the game wrapper and show the lobby selection by default
    // This logic might be overridden by loadGameStateFromStorage if there's a saved game
    if (!currentUiJson) {
        if(gameWrapper) gameWrapper.style.display = 'none';
        if(lobbyContainer) lobbyContainer.style.display = 'none';
        if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'block';
    }


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

// --- Spinner Mini-Game Functions ---

let activeSpinners = [];

function populateSpinner(wheelElement, legendElement, spinnerData) {
    if (!wheelElement || !legendElement) return;
    wheelElement.innerHTML = ''; // Clear previous segments and symbols
    legendElement.innerHTML = `<h4>${spinnerData.title}</h4>`;

    const { items } = spinnerData; // Items are now { text: string, weight: number }
    if (items.length === 0) {
        wheelElement.textContent = "No items";
        return;
    }

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return;

    const colors = ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];
    const symbols = ["❤️", "⭐", "💎", "🍀", "💧", "🌙", "💜", "✨"];

    let cumulativePercent = 0;
    const gradientParts = [];

    items.forEach((item, index) => {
        const percent = (item.weight / totalWeight) * 100;
        const color = colors[index % colors.length];

        gradientParts.push(`${color} ${cumulativePercent}% ${cumulativePercent + percent}%`);

        // --- Place Symbol ---
        const symbol = symbols[index % symbols.length];
        const symbolDiv = document.createElement('div');
        symbolDiv.className = 'segment-content'; // Re-use styling
        symbolDiv.textContent = symbol;

        const midpointPercent = cumulativePercent + percent / 2;
        // Calculate angle, subtracting 90 degrees (PI/2 radians) to make 0 degrees point upwards
        const midpointAngleRad = (midpointPercent / 100) * 2 * Math.PI - (Math.PI / 2);

        const radius = wheelElement.offsetWidth / 2 * 0.6; // 60% of the way out
        const x = (wheelElement.offsetWidth / 2) + radius * Math.cos(midpointAngleRad);
        const y = (wheelElement.offsetHeight / 2) + radius * Math.sin(midpointAngleRad);

        symbolDiv.style.left = `${x}px`;
        symbolDiv.style.top = `${y}px`;
        symbolDiv.style.transform = 'translate(-50%, -50%)'; // Center the symbol on the calculated point

        wheelElement.appendChild(symbolDiv);

        // --- Add to legend ---
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        const weightIndicator = item.weight > 1 ? ' (x2)' : '';
        legendItem.innerHTML = `<span class="legend-symbol" style="color: ${color};">${symbol}</span> ${item.text}${weightIndicator}`;
        legendElement.appendChild(legendItem);

        cumulativePercent += percent;
    });

    wheelElement.style.background = `conic-gradient(${gradientParts.join(', ')})`;
}

function runSpinnerAnimation(currentTime) {
    if (activeSpinners.every(s => !s.isSpinning)) {
        if (amIPlayer1) endSpinner();
        return;
    }

    const deltaTime = (currentTime - lastSpinnerFrameTime) / 1000;
    lastSpinnerFrameTime = currentTime;

    activeSpinners.forEach(spinner => {
        if (!spinner.isSpinning) return;

        if (amIPlayer1) {
            spinner.velocity *= Math.pow(FRICTION, deltaTime * 60);
            if (Math.abs(spinner.velocity) < MIN_SPINNER_VELOCITY) {
                spinner.velocity = 0;
                spinner.isSpinning = false;
                // Determine result now that it has stopped
                const totalWeight = spinner.items.reduce((sum, item) => sum + item.weight, 0);
                const finalAngleDegrees = (spinner.angle * 180 / Math.PI) % 360;
                const pointerAngle = 270; // 12 o'clock
                const normalizedAngle = (360 - finalAngleDegrees + pointerAngle) % 360;

                const targetPoint = (normalizedAngle / 360) * totalWeight;
                let cumulativeWeight = 0;
                for (const item of spinner.items) {
                    cumulativeWeight += item.weight;
                    if (targetPoint <= cumulativeWeight) {
                        spinner.result = item.text; // Set result to the text of the item
                        break;
                    }
                }
                console.log(`Spinner ${spinner.id} stopped. Result: ${spinner.result}`);

            } else {
                 spinner.angle += spinner.velocity * deltaTime;
            }
        }

        spinner.wheelElement.style.transform = `rotate(${spinner.angle}rad)`;
    });

    if (amIPlayer1) {
        const spinnerStates = activeSpinners.map(s => ({
            id: s.id,
            angle: s.angle,
            isSpinning: s.isSpinning,
            result: s.result
        }));
        MPLib.broadcastToRoom({ type: 'spinner_state_update', payload: { spinners: spinnerStates } });
    }

    requestAnimationFrame(runSpinnerAnimation);
}

function startSpinner(spinnersData, onComplete) {
    console.log(`Starting ${spinnersData.length} spinners...`);
    spinnerCompletionCallback = onComplete;
    activeSpinners = [];

    const spinnersArea = document.getElementById('spinners-area');
    spinnersArea.innerHTML = '';

    if (spinnerModal) {
        spinnerTitle.textContent = 'Spinning for the Scene!';
        spinnerModal.style.display = 'flex';
    }
    if (spinnerResult) spinnerResult.style.display = 'none';

    spinnersData.forEach((data, index) => {
        const spinnerUnit = document.createElement('div');
        spinnerUnit.className = 'spinner-unit';

        const container = document.createElement('div');
        container.className = 'spinner-container';
        const pointer = document.createElement('div');
        pointer.className = 'spinner-pointer';
        const wheel = document.createElement('div');
        wheel.className = 'spinner-wheel';
        wheel.id = `spinner-wheel-${index}`;
        container.append(pointer, wheel);

        const legend = document.createElement('div');
        legend.className = 'spinner-legend';
        legend.id = `spinner-legend-${index}`;

        spinnerUnit.append(container, legend);
        spinnersArea.appendChild(spinnerUnit);

        const spinnerState = {
            id: index,
            wheelElement: wheel,
            items: data.items,
            angle: 0,
            velocity: 0,
            isSpinning: false,
            result: null,
            segmentSymbols: {}
        };
        activeSpinners.push(spinnerState);

        populateSpinner(wheel, legend, { ...data, segmentSymbols: spinnerState.segmentSymbols });

        if (amIPlayer1) {
            spinnerState.isSpinning = true;
            spinnerState.velocity = 15 + Math.random() * 10; // Increased speed
        }
    });

    if (amIPlayer1) {
        lastSpinnerFrameTime = performance.now();
        requestAnimationFrame(runSpinnerAnimation);
    }
}


function endSpinner() {
    isSpinnerRunning = false;
    const finalResults = activeSpinners.map(s => s.result).filter(Boolean);
    console.log("All spinners stopped. Final results:", finalResults);

    if (finalResults.length === activeSpinners.length) {
        // --- NEW: Highlight winners in the legend ---
        activeSpinners.forEach(spinner => {
            if (spinner.result) {
                const legendId = spinner.wheelElement.id.replace('wheel', 'legend');
                const legend = document.getElementById(legendId);
                if (legend) {
                    const legendItems = legend.querySelectorAll('.legend-item');
                    legendItems.forEach(item => {
                        // Using .includes() for robustness, in case of extra spaces or "(x2)"
                        if (item.textContent.includes(spinner.result)) {
                            item.classList.add('winner');
                        }
                    });
                }
            }
        });
        // --- END NEW ---

        // Hide modal and fire callback after a short delay
        setTimeout(() => {
            if (spinnerModal) spinnerModal.style.display = 'none';
            if (spinnerCompletionCallback) {
                spinnerCompletionCallback(finalResults);
            }
            activeSpinners = [];
        }, 4000); // Increased delay to 4s as per user feedback
    } else {
        console.error("Mismatch in spinner results. Aborting.");
        setTimeout(() => {
            if (spinnerModal) spinnerModal.style.display = 'none';
            if (spinnerCompletionCallback) {
                spinnerCompletionCallback([]);
            }
            activeSpinners = [];
        }, 1500);
    }
}

// Handler for incoming state updates from Player 1
function handleSpinnerStateUpdate(spinnersState) {
    if (amIPlayer1) return;

    let allStopped = true;
    spinnersState.forEach(state => {
        const localSpinner = activeSpinners.find(s => s.id === state.id);
        if (localSpinner) {
            localSpinner.angle = state.angle;
            localSpinner.isSpinning = state.isSpinning;
            localSpinner.result = state.result; // Make sure result is updated
            localSpinner.wheelElement.style.transform = `rotate(${state.angle}rad)`;

            if (state.isSpinning) {
                allStopped = false;
            }
        }
    });

    // If all have stopped, end the spinner on the client side
    if (allStopped) {
        console.log("Player 2 detected all spinners stopped, ending spinner.");
        endSpinner();
    } else {
         // keep animation frame running if any spinner is still going
        requestAnimationFrame(runSpinnerAnimation);
    }
}

// Ensure DOM is fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeGame);
