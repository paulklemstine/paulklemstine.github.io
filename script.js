// Import prompts from the separate file (if still needed for single-player)
import {geemsPrompts, sceneFeatures, getDynamicSceneOptions, getMinigameActions, getMinigameRoundOutcome} from './prompts.js';
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
let playerScore = 0;
let partnerScore = 0;
let playerMove = null;
let partnerMove = null;
let minigameRound = 1;
let player1IsInitiator = true;
let minigameActionData = null; // To hold LLM-generated actions and rules
let preloadedMinigameData = null; // To preload the *next* turn's actions

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
let turnSubmissions = new Map(); // New state for turn aggregation
let incomingProposal = null;
let isDateExplicit = false;
let globalRoomDirectory = { rooms: {}, peers: {} }; // Holds the global state
let currentRoomName = null; // The name of the room the user is currently in
let currentRoomIsPublic = true; // Whether the current room is public or private
let localPlayerAnalysis = null;
let partnerPlayerAnalysis = null;

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
        isFirstTurn = false,
        minigameWinner = null, // new
        history = []
    } = turnData;

    const activeAddendum = isExplicit ? `\n\n---\n${geemsPrompts.masturbationModeAddendum}\n---\n` : "";
    let minigameAddendum = '';
    if (minigameWinner) {
        // This function is only ever called by Player 1, who is always Player A in this context.
        const winner = (minigameWinner === 'player') ? 'Player A' : 'Player B';
        const loser = (winner === 'Player A') ? 'Player B' : 'Player A';
        minigameAddendum = `\n\n---\nMINIGAME RESULT\n---\nThe pre-turn minigame was won by ${winner}. The loser was ${loser}. You MUST incorporate this result into the turn. Reward the winner with a small advantage, a moment of good luck, or a positive comment from their partner. You MUST punish the loser with a small disadvantage, an embarrassing moment, or a teasing comment from Dr. Gemini. Be creative and subtle.`;
    }

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
                const historyString = history.map((turn, index) => {
                    // Safely parse actions to get notes, if possible
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
                }).join('\n\n---\n\n'); // Separator for clarity
                prompt += `\n\n---\nCONTEXT: LAST ${history.length} TURNS (Most recent first)\n---\n${historyString}`;
            }

            prompt += `\n\n---\nLATEST TURN DATA\n---\n`;
            prompt += `player_input_A: ${JSON.stringify(playerA_actions)}\n`;
            prompt += `previous_notes_A: ${JSON.stringify(playerA_notes)}\n\n`;
            prompt += `player_input_B: ${JSON.stringify(playerB_actions)}\n`;
            prompt += `previous_notes_B: ${JSON.stringify(playerB_notes)}\n`;
            prompt += activeAddendum;
            prompt += minigameAddendum;
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
        // actions.notes is a string from the hidden input, so we parse it.
        const newNotesObject = JSON.parse(actions.notes);
        // Compare stringified versions to detect changes in the object.
        if (JSON.stringify(profile.personality.notes) !== JSON.stringify(newNotesObject)) {
            profile.personality.notes = newNotesObject; // Store the actual object
            updated = true;
            console.log("Updated personality notes object.");
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
 * Generates the Red/Green flags and Clinical Profile for the local player.
 * @param {object} playerActions - The actions the player just took.
 * @param {string} playerNotes - The player's notes from the previous turn.
 * @param {Array} history - The full game history.
 * @returns {Promise<object|null>} A promise that resolves to the analysis object or null on failure.
 */
async function generatePlayerAnalysis(playerActions, playerNotes, history) {
    console.log("Generating player analysis...");
    try {
        let prompt = geemsPrompts.dr_gemini_analysis_prompt;

        // Add history section if it exists
        if (history && history.length > 0) {
            const historyString = history.map((turn, index) => `Turn ${history.length - index} ago:\n- Player-Facing UI:\n\`\`\`json\n${turn.ui}\n\`\`\`\n- Player Actions Taken:\n\`\`\`json\n${turn.actions}\n\`\`\``).join('\n\n---\n\n');
            prompt += `\n\n---\nCONTEXT: PLAYER'S LAST ${history.length} TURNS (Most recent first)\n---\n${historyString}`;
        }

        prompt += `\n\n---\nLATEST TURN DATA FOR THIS PLAYER\n---\n`;
        prompt += `player_input: ${JSON.stringify(playerActions)}\n`;
        prompt += `previous_notes: ${JSON.stringify(playerNotes)}\n`;
        prompt += `\n--- Generate the analysis JSON based on the above. ---`;

        const analysisJsonString = await callGeminiApiWithRetry(prompt);
        const analysis = JSON.parse(analysisJsonString);
        console.log("Successfully generated player analysis:", analysis);
        return analysis;

    } catch (error) {
        console.error("Error during player analysis generation:", error);
        showError("Failed to generate Dr. Gemini's analysis.");
        return null;
    }
}


/**
 * Populates the interstitial screen with the analysis reports.
 */
function renderInterstitialReports() {
    console.log("Rendering interstitial reports with received data.");
    const localProfile = getLocalProfile();
    const partnerMasterId = MPLib.getRoomConnections()?.get(currentPartnerId)?.metadata?.masterId;
    const partnerProfile = remoteGameStates.get(partnerMasterId)?.profile || { name: "Partner" };

    // Set names
    document.getElementById('local-player-name').textContent = localProfile.name || 'You';
    document.getElementById('partner-player-name').textContent = partnerProfile.name || 'Your Partner';

    // Populate the 'You' column
    document.getElementById('local-green-flags').innerHTML = localPlayerAnalysis?.green_flags || '<em>Analysis pending...</em>';
    document.getElementById('local-red-flags').innerHTML = localPlayerAnalysis?.red_flags || '<em>Analysis pending...</em>';
    document.getElementById('local-clinical-report').innerHTML = (localPlayerAnalysis?.clinical_profile || '<em>Analysis pending...</em>').replace(/\\n/g, '<br>');

    // Populate the 'Partner' column
    document.getElementById('partner-green-flags').innerHTML = partnerPlayerAnalysis?.green_flags || '<em>Analysis pending...</em>';
    document.getElementById('partner-red-flags').innerHTML = partnerPlayerAnalysis?.red_flags || '<em>Analysis pending...</em>';
    document.getElementById('partner-clinical-report').innerHTML = (partnerPlayerAnalysis?.clinical_profile || '<em>Analysis pending...</em>').replace(/\\n/g, '<br>');

    interstitialSpinner.style.display = 'none';
    interstitialReports.classList.remove('hidden');
}


/**
 * Checks if both local and partner analysis are ready, then renders them.
 * This function is now ONLY responsible for rendering the report text.
 * It does not enable the continue button anymore.
 */
function checkAndRenderInterstitial() {
    if (localPlayerAnalysis && partnerPlayerAnalysis) {
        console.log("Both local and partner analyses are ready. Rendering reports.");
        const interstitialTitle = document.querySelector('#interstitial-screen h2');
        if (interstitialTitle) interstitialTitle.textContent = "Dr. Gemini's Report";

        renderInterstitialReports();
        checkIfReadyToContinue(); // Check if we can proceed
    } else {
        console.log("Still waiting for all analysis data.", { hasLocal: !!localPlayerAnalysis, hasPartner: !!partnerPlayerAnalysis });
    }
}

/**
 * Checks if all data (analyses and next turn UI) is ready to proceed.
 * If so, it enables the continue button on the interstitial screen.
 */
function checkIfReadyToContinue() {
    const analysisReady = !!localPlayerAnalysis && (isDateActive ? !!partnerPlayerAnalysis : true);
    const nextTurnUiReady = !!bufferedNextTurnUi && (isDateActive ? partnerFinishedBuffering : true);

    console.log("Checking if ready to continue...", { analysisReady, nextTurnUiReady });

    if (analysisReady && nextTurnUiReady) {
        console.log("All data is ready. Enabling continue button.");
        interstitialContinueButton.disabled = false;
    }
}


/**
 * Generates the UI for the current player by calling the main UI generator prompt.
 * This function is now a utility that returns the UI JSON without rendering it.
 * @param {string} orchestratorText - The full plain text output from the orchestrator.
 * @param {string} playerRole - Either 'player1' or 'player2'.
 * @returns {Promise<object>} A promise that resolves to the UI JSON object.
 */
async function generateLocalTurn(orchestratorText, playerRole) {
    console.log(`Generating local turn UI for ${playerRole}...`);

    const parts = orchestratorText.split('---|||---');
    if (parts.length !== 3) {
        throw new Error("Invalid orchestrator output format. Full text: " + orchestratorText);
    }

    const playerNumber = (playerRole === 'player1') ? 1 : 2;
    const instructions = parts[playerNumber];

    const prompt = geemsPrompts.master_ui_prompt + "\n\n" + instructions;
    const uiJsonString = await callGeminiApiWithRetry(prompt);
    let uiJson = JSON.parse(uiJsonString);

    if (!Array.isArray(uiJson) && typeof uiJson === 'object' && uiJson !== null) {
        const arrayKey = Object.keys(uiJson).find(key => Array.isArray(uiJson[key]));
        if (arrayKey) {
            console.warn(`API returned an object. Found an array at key: '${arrayKey}'`);
            uiJson = uiJson[arrayKey];
        }
    }
    console.log(`Finished generating UI for ${playerRole}.`);
    return uiJson; // Return the JSON
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
        return;
    }

    if (turnSubmissions.size < requiredSubmissions) {
        console.log(`Have ${turnSubmissions.size}/${requiredSubmissions} submissions. Waiting...`);
        return;
    }

    console.log("All turns received. Starting minigame before next turn generation.");

    startMinigame((winner) => {
        if (amIPlayer1) {
            const myRoomId = MPLib.getLocalRoomId();
            const partnerRoomId = roomConnections.keys().next().value;
            const playerA_actions = turnSubmissions.get(myRoomId);
            const playerB_actions = turnSubmissions.get(partnerRoomId);

            if (!playerA_actions || !playerB_actions) {
                showError("FATAL: Could not map submissions to players. Aborting turn.");
                if (spinnerModal) spinnerModal.style.display = 'none';
                turnSubmissions.clear();
                return;
            }

            initiateTurnAsPlayer1({
                playerA_actions: playerA_actions,
                playerB_actions: playerB_actions,
                playerA_notes: JSON.parse(playerA_actions.notes || '{}'),
                playerB_notes: JSON.parse(playerB_actions.notes || '{}'),
                isExplicit: isDateExplicit,
                history: historyQueue,
                minigameWinner: winner
            });

            turnSubmissions.clear();
        } else {
            console.log("I am Player 2. My work is done for this turn, waiting for P1.");
            turnSubmissions.clear();
        }
    });
}

/**
 * Initiates the generation of the *next* turn's UI for a single player.
 * This runs in the background while the player views the analysis of the current turn.
 */
async function initiateTurnGenerationSinglePlayer(playerActions, history) {
    console.log("Initiating single-player NEXT turn generation...");
    try {
        const parsedNotes = JSON.parse(playerActions.notes || '{}');
        const orchestratorTurnData = {
            playerA_actions: playerActions, playerB_actions: playerActions,
            playerA_notes: parsedNotes, playerB_notes: parsedNotes,
            isExplicit: isExplicitMode, history: history
        };

        const orchestratorPrompt = constructPrompt('orchestrator', orchestratorTurnData);
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");
        currentOrchestratorText = orchestratorText;

        bufferedNextTurnUi = await generateLocalTurn(orchestratorText, 'player1');

        console.log("Single player next turn UI buffered.");
        checkIfReadyToContinue();

    } catch (error) {
        console.error("Error during single-player turn generation:", error);
        showError("Failed to generate the next turn. You may be stuck.");
    }
}

/**
 * Kicks off the next turn generation process. Called only by Player 1.
 * This function makes the 'orchestrator' call and distributes the plan.
 * It does NOT handle analysis, only UI generation for the next turn.
 */
async function initiateTurnAsPlayer1(turnData) {
    console.log("Player 1 is initiating NEXT turn generation...");

    try {
        const orchestratorPrompt = constructPrompt('orchestrator', turnData);
        const orchestratorText = await callGeminiApiWithRetry(orchestratorPrompt, "text/plain");
        currentOrchestratorText = orchestratorText;

        MPLib.sendDirectToRoomPeer(currentPartnerId, {
            type: 'orchestrator_output',
            payload: { orchestratorText }
        });

        bufferedNextTurnUi = await generateLocalTurn(orchestratorText, 'player1');
        console.log("P1 has buffered the next turn UI.");

        MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'next_turn_buffered' });
        checkIfReadyToContinue();

    } catch (error) {
        console.error("Error during Player 1's turn initiation:", error);
        showError("Failed to start the next turn due to an AI error.");
        MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'generation_error', payload: { message: "Partner failed to generate the next turn." }});
        setLoading(false);
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

// --- Minigame Functions ---

async function startMinigame(onComplete) {
    console.log("Starting 'Make a Move' Minigame...");
    minigameActive = true;
    minigameCompletionCallback = onComplete;
    playerScore = 0;
    partnerScore = 0;
    minigameRound = 1;
    player1IsInitiator = true; // Player 1 always starts as the initiator
    minigameActionData = null; // Clear old data
    preloadedMinigameData = null; // Clear old data

    if (minigameModal) minigameModal.style.display = 'flex';

    // Player 1 is responsible for generating and distributing the game data
    if (amIPlayer1) {
        minigameTitle.textContent = "Generating Actions...";
        try {
            const data = await getMinigameActions(isDateExplicit, callGeminiApiWithRetry);
            if (data) {
                minigameActionData = data;
                MPLib.broadcastToRoom({ type: 'minigame_data', payload: data });
                console.log("Minigame data generated and broadcasted.");
                // Preload the next turn's data immediately
                getMinigameActions(isDateExplicit, callGeminiApiWithRetry).then(preloadData => {
                    preloadedMinigameData = preloadData;
                    MPLib.broadcastToRoom({ type: 'minigame_preload_data', payload: preloadData });
                    console.log("Preloaded minigame data for next round and sent to partner.");
                });
                minigameTitle.textContent = "Make a Move";
                resetRoundUI(); // Now we can setup the UI
            } else {
                showError("Could not generate minigame actions. Closing minigame.");
                setTimeout(() => minigameModal.style.display = 'none', 3000);
            }
        } catch (error) {
            console.error("Error getting minigame actions:", error);
            showError("Failed to start minigame due to an API error.");
        }
    } else {
        // Player 2 just waits for the data
        minigameTitle.textContent = "Partner is Generating Actions...";
        roundResultDisplay.textContent = "Waiting for partner to create the game...";
    }

    updateScoreboard();
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

        // --- New UI Feedback Logic ---
        const yourMoveText = playerMove.replace(/_/g, ' ');
        const partnerMoveText = partnerMove.replace(/_/g, ' ');
        roundResultDisplay.innerHTML = `You chose <strong class="text-indigo-600">${yourMoveText}</strong>. Your partner chose <strong class="text-pink-600">${partnerMoveText}</strong>.`;
        // --- End New UI Feedback Logic ---

        // Wait a moment before revealing the winner
        setTimeout(async () => {
            const winnerRole = determineRoundWinner(initiatorMove, receiverMove);

            // Dynamically get the outcome visualization
            try {
                const outcome = await getMinigameRoundOutcome(initiatorMove, receiverMove, winnerRole, isDateExplicit, callGeminiApiWithRetry);
                if (outcome && resultImage && resultNarrative && graphicalResultDisplay) {
                    resultNarrative.textContent = outcome.narrative;
                    const randomSeed = Math.floor(Math.random() * 65536);
                    resultImage.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(outcome.image_prompt)}?nologo=true&safe=false&seed=${randomSeed}`;
                    graphicalResultDisplay.classList.remove('hidden');
                }
            } catch (e) {
                console.error("Could not generate round outcome visualization:", e);
            }


            let roundMessage = "It's a draw this round!";
            if (winnerRole && winnerRole !== 'draw') {
                 const iAmWinner = (iAmInitiator && winnerRole === 'initiator') || (!iAmInitiator && winnerRole === 'receiver');
                 if (iAmWinner) {
                     playerScore++;
                     roundMessage = "You won the round!";
                 } else {
                     partnerScore++;
                     roundMessage = "Your partner won the round.";
                 }
            }

            roundResultDisplay.innerHTML += `<br>${roundMessage}`;
            updateScoreboard();

            if (playerScore >= 2 || partnerScore >= 2) {
                endMinigame();
            } else {
                minigameRound++;
                player1IsInitiator = !player1IsInitiator; // Swap roles
                setTimeout(resetRoundUI, 5000); // Increased delay to show image
            }
        }, 2500); // 2.5 second delay to show moves
    }
}

function determineRoundWinner(initiatorMove, receiverMove) {
    if (!minigameActionData || !minigameActionData.rules) {
        console.error("Cannot determine winner: minigameActionData.rules is not available.");
        return 'draw'; // Fail safe to a draw
    }
    // Returns 'initiator', 'receiver', or 'draw'.
    const winner = minigameActionData.rules[initiatorMove]?.[receiverMove];
    return winner || 'draw'; // Default to draw if a rule is somehow missing
}

function endMinigame() {
    minigameActive = false;
    const winner = playerScore > partnerScore ? 'player' : 'partner';
    minigameSubtitle.textContent = `Game Over! You ${winner === 'player' ? 'WON!' : 'LOST!'}`;
    setMoveButtonsDisabled(true);

    setTimeout(() => {
        if (minigameModal) minigameModal.style.display = 'none';
        if (minigameCompletionCallback) {
            minigameCompletionCallback(winner);
        }
    }, 4000);
}

function resetRoundUI() {
    playerMove = null;
    partnerMove = null;

    // Hide the graphical result from the previous round
    if (graphicalResultDisplay) {
        graphicalResultDisplay.classList.add('hidden');
        resultImage.src = ""; // Clear image to prevent flash of old content
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
        roundResultDisplay.textContent = `Round ${minigameRound}: Make your move...`;
        controlsDiv.style.display = 'block';
        otherControlsDiv.style.display = 'none';
    } else {
        roundResultDisplay.textContent = `Round ${minigameRound}: Respond to your partner...`;
        controlsDiv.style.display = 'block';
        otherControlsDiv.style.display = 'none';
    }

    setMoveButtonsDisabled(false); // This function will now disable all buttons in both containers
}

function updateScoreboard() {
    playerScoreDisplay.textContent = playerScore;
    partnerScoreDisplay.textContent = partnerScore;
}

function setMoveButtonsDisabled(disabled) {
    // Select all buttons within the minigame controls
    const buttons = document.querySelectorAll('#initiator-controls .minigame-button, #receiver-controls .minigame-button');
    buttons.forEach(button => {
        button.disabled = disabled;
    });
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
            if (data.payload && data.payload.spinners) {
                handleSpinnerStateUpdate(data.payload.spinners);
            }
            break;

        case 'minigame_data':
            if (minigameActive && !amIPlayer1) {
                minigameActionData = data.payload;
                console.log("Received minigame data from Player 1.", minigameActionData);
                resetRoundUI();
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
            console.log(`Received turn submission from ${senderId.slice(-6)}`);
            if (isDateActive) {
                const actions = data.payload;
                turnSubmissions.set(senderId, actions);
                checkForTurnCompletion();
            }
            break;

        case 'orchestrator_output':
            console.log(`Received orchestrator output from ${senderId.slice(-6)}`);
            if (isDateActive && !amIPlayer1) {
                const { orchestratorText } = data.payload;
                currentOrchestratorText = orchestratorText;

                // Player 2 generates their UI and buffers it
                generateLocalTurn(orchestratorText, 'player2')
                    .then(uiJson => {
                        bufferedNextTurnUi = uiJson;
                        console.log("P2 has buffered the next turn UI.");
                        MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'next_turn_buffered' });
                        checkIfReadyToContinue();
                    })
                    .catch(error => {
                        console.error("Error during Player 2's turn generation:", error);
                        showError("Failed to generate your turn due to an AI error from your partner.");
                        MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'generation_error', payload: { message: "Partner failed to generate their turn." }});
                    });
            }
            break;

        case 'analysis_swap':
            console.log(`Received analysis swap from partner ${senderId.slice(-6)}`);
            partnerPlayerAnalysis = data.payload;
            checkAndRenderInterstitial();
            break;

        case 'next_turn_buffered':
            console.log(`Partner ${senderId.slice(-6)} has finished buffering their next turn.`);
            partnerFinishedBuffering = true;
            checkIfReadyToContinue();
            break;

        case 'generation_error':
            console.error("Received a generation error from partner:", data.payload.message);
            showError(data.payload.message);
            setLoading(false); // Unlock the UI
            break;

        case 'profile_update':
            console.log(`Received profile update from ${senderId.slice(-6)}`, data.payload);
            const masterId = MPLib.getRoomConnections().get(senderId)?.metadata?.masterId || senderId;
            if (!remoteGameStates.has(masterId)) {
                remoteGameStates.set(masterId, {});
            }
            remoteGameStates.get(masterId).profile = data.payload;
            console.log(`Updated remote profile for ${masterId.slice(-6)}`);

            if (lobbyContainer.style.display === 'block') {
                renderLobby();
            }
            break;

        case 'scene_options':
            if (!amIPlayer1) {
                console.log("Received scene options from Player 1:", data.payload);
                startSceneSelection(data.payload);
            }
            break;
        case 'graceful_disconnect':
            console.log(`Received graceful disconnect from ${senderId.slice(-6)}`);
            MPLib.closeConnection(senderId);
            break;
        case 'llm_overloaded':
            console.log("Received LLM overloaded message from partner.");
            showError("The AI is currently overloaded. Please wait a moment and resubmit your turn.");
            setLoading(false);
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
    if (isDateActive) return;
    const roomListContainer = document.getElementById('room-list');
    const directoryContainer = document.getElementById('global-directory-container');
    if (!roomListContainer || !directoryContainer) return;

    directoryContainer.style.display = 'block';
    roomListContainer.innerHTML = '';

    const { rooms } = globalRoomDirectory;

    if (Object.keys(rooms).length === 0) {
        roomListContainer.innerHTML = '<p class="text-gray-500">No public rooms are active. Why not create one?</p>';
        return;
    }

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

submitButton.addEventListener('click', () => {
    if (isLoading) return;
    setLoading(true); // Show interstitial screen immediately, disable all inputs

    const playerActionsJson = collectInputState();
    updateHistoryQueue(playerActionsJson);
    const playerActions = JSON.parse(playerActionsJson);
    updateLocalProfileFromTurn(playerActions);

    // --- Start Analysis of THIS turn in the background ---
    generatePlayerAnalysis(playerActions, JSON.parse(playerActions.notes || '{}'), historyQueue)
        .then(analysis => {
            if (analysis) {
                localPlayerAnalysis = analysis;
                if (isDateActive) {
                    MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'analysis_swap', payload: localPlayerAnalysis });
                } else {
                    // In single player, partner's analysis is the same as local
                    partnerPlayerAnalysis = analysis;
                }
                checkAndRenderInterstitial();
            }
        })
        .catch(error => {
            console.error("Analysis generation failed:", error);
            showError("Dr. Gemini's analysis failed. You can continue when the next turn is ready.");
            localPlayerAnalysis = { error: "Failed to generate." };
            if (isDateActive) {
                 MPLib.sendDirectToRoomPeer(currentPartnerId, { type: 'analysis_swap', payload: localPlayerAnalysis });
            } else {
                 partnerPlayerAnalysis = { error: "Failed to generate." };
            }
            checkAndRenderInterstitial();
        });


    if (isDateActive) {
        // --- Submit THIS turn's actions to partner to trigger NEXT turn's generation ---
        const myRoomId = MPLib.getLocalRoomId();
        if (myRoomId) {
            turnSubmissions.set(myRoomId, playerActions);
            console.log(`Locally recorded submission for ${myRoomId.slice(-6)}`);
            MPLib.broadcastToRoom({ type: 'turn_submission', payload: playerActions });
            checkForTurnCompletion();
        } else {
            console.error("Could not get local room ID to record submission.");
            setLoading(false);
            showError("A local error occurred. Could not submit turn.");
        }
    } else {
        // --- Single-Player: Start NEXT turn generation in the background ---
        initiateTurnGenerationSinglePlayer(playerActions, historyQueue);
    }
});


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
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.removeItem('sparksync_apiKey');
        localStorage.removeItem(LOCAL_PROFILE_KEY);
        localStorage.removeItem('sparksync_hivemind');
        localStorage.removeItem('sparksync_lastLobby');
        console.log("Cleared localStorage, including user profile.");
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

    const playersToRender = [];

    if (localMasterId) {
        playersToRender.push({
            id: localMasterId,
            profile: localProfile,
            isLocal: true
        });
    }

    const remotePeers = MPLib.getRoomConnections ? Array.from(MPLib.getRoomConnections().values()) : [];
    remotePeers.forEach(conn => {
        if (conn && conn.open) {
            const peerMasterId = conn.metadata?.masterId || conn.peer;
            const remoteState = remoteGameStates.get(peerMasterId) || {};
            playersToRender.push({
                id: peerMasterId,
                profile: remoteState.profile || { name: `User-${peerMasterId.slice(-4)}`, gender: "Unknown", physical: {} },
                isLocal: false,
                roomConnection: conn
            });
        }
    });

    if (playersToRender.length <= 1) {
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
                button.dataset.masterId = player.id;

                if (player.roomConnection && player.roomConnection.open) {
                    button.textContent = 'Propose Date';
                    button.disabled = false;
                    button.onclick = (event) => {
                        const targetMasterId = event.target.dataset.masterId;

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

    proposalAcceptButton.onclick = () => {
        if (!incomingProposal) return;
        console.log(`Accepting date from ${incomingProposal.proposerId}`);
        const payload = {
            accepterExplicitMode: isExplicitMode
        };
        MPLib.sendDirectToRoomPeer(incomingProposal.proposerId, { type: 'date_accepted', payload: payload });
        proposalModal.style.display = 'none';

        isDateExplicit = isExplicitMode && incomingProposal.proposerExplicitMode;
        console.log(`Date explicit mode set to: ${isDateExplicit}`);

        startNewDate(incomingProposal.proposerId, false);
        incomingProposal = null;
    };

    proposalDeclineButton.onclick = () => {
        if (!incomingProposal) return;
        console.log(`Declining date from ${incomingProposal.proposerId}`);
        MPLib.sendDirectToRoomPeer(incomingProposal.proposerId, { type: 'date_declined' });
        proposalModal.style.display = 'none';
        incomingProposal = null;
    };

    proposalModal.style.display = 'flex';
}
window.showProposalModal = showProposalModal;

/** Transitions from lobby to game view and initializes date state */
async function startNewDate(partnerId, iAmPlayer1) {
    console.log(`Starting new date with ${partnerId}. Am I Player 1? ${iAmPlayer1}`);

    isDateActive = true;
    currentPartnerId = partnerId;
    amIPlayer1 = iAmPlayer1;
    turnSubmissions.clear();
    sceneSelections.clear();

    const directoryContainer = document.getElementById('global-directory-container');
    if(directoryContainer) directoryContainer.style.display = 'none';
    if(lobbyContainer) lobbyContainer.style.display = 'none';
    if(gameWrapper) gameWrapper.style.display = 'block';

    if (amIPlayer1) {
        if (firstDateLoadingModal) firstDateLoadingModal.style.display = 'flex';
        try {
            const dynamicOptions = await getDynamicSceneOptions(isDateExplicit, callGeminiApiWithRetry);
            MPLib.broadcastToRoom({ type: 'scene_options', payload: dynamicOptions });
            startSceneSelection(dynamicOptions);
        } catch (error) {
            console.error("Error generating dynamic scene options:", error);
            showError("Could not generate scene options. Please try starting a new date.");
            startSceneSelection(sceneFeatures);
        } finally {
            if (firstDateLoadingModal) firstDateLoadingModal.style.display = 'none';
        }
    } else {
        uiContainer.innerHTML = `<div class="text-center p-8"><h2>Waiting for Player 1 to set the scene...</h2><p>The first date options will appear here shortly.</p></div>`;
    }
}

function startSceneSelection(options) {
    console.log("Starting scene selection with 3 categories...");
    uiContainer.innerHTML = `<div class="text-center p-8"><h2>Let's set the scene...</h2><p>Choose some elements for your first date. Your choices will be combined with your partner's to create the setting.</p></div>`;

    const selectionGrid = document.createElement('div');
    selectionGrid.className = 'scene-selection-grid';

    const locations = options?.locations || sceneFeatures.locations;
    const vibes = options?.vibes || sceneFeatures.vibes;
    const wildcards = options?.wildcards || sceneFeatures.wildcards;

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
            weight: count
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

    startSpinner(
        [
            { title: 'Location', items: locationItems },
            { title: 'Vibe', items: vibeItems },
            { title: 'Wildcard', items: wildcardItems }
        ],
        (winningResults) => {
            if (amIPlayer1) {
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
    setLoading(true, true);

    const localProfile = getLocalProfile();
    const profileString = `Player A's saved profile: ${JSON.stringify(localProfile)}. If profile data exists, use it when creating the notes and UI. Otherwise, ensure the UI probes for it.`;

    const initialTurnData = {
        playerA_actions: { turn: 0, action: "game_start" },
        playerB_actions: { turn: 0, action: "game_start" },
        playerA_notes: { summary: `New subject (Player 1) starting date in scene: ${scene}.` },
        playerB_notes: { summary: `New subject (Player 2) starting date in scene: ${scene}.` },
        isExplicit: isDateExplicit,
        minigameWinner: minigameWinner,
        isFirstTurn: true
    };

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

    if (roomName === currentRoomName) {
        showNotification("You are already in this room.", "warn");
        return;
    }

    const lobby = document.getElementById('lobby-container');
    if (lobby) {
        lobby.innerHTML = `<h2>Joining ${roomName}...</h2>`;
    }

    MPLib.leaveRoom();

    currentRoomName = roomName;
    currentRoomIsPublic = isPublic;
    MPLib.joinRoom(roomName);
}

function loadGameStateFromStorage() {
    const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedStateJSON) {
        try {
            const savedState = JSON.parse(savedStateJSON);
            currentUiJson = savedState.currentUiJson || null;
            historyQueue = savedState.historyQueue || [];
            isExplicitMode = savedState.isExplicitMode || false;
            currentModelIndex = savedState.currentModelIndex || 0;

            console.log("Game state loaded from localStorage.");

            if (currentUiJson) {
                renderUI(currentUiJson);
                apiKeyLocked = true;
                resetGameButton.disabled = false;
                 if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'none';
                 if(gameWrapper) gameWrapper.style.display = 'block';
            }
            updateModeButtonVisuals();
            updateModelToggleVisuals();

        } catch (error) {
            console.error("Error loading game state from localStorage:", error);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
    }
}

function initializeGame() {
    console.log("Initializing Flagged with new Master Directory architecture...");
    loadGameStateFromStorage();

    interstitialContinueButton.addEventListener('click', () => {
        if (!bufferedNextTurnUi) {
            console.error("Continue button clicked, but no buffered UI to render!");
            return;
        }

        interstitialScreen.style.display = 'none';
        window.scrollTo(0, 0);

        currentUiJson = bufferedNextTurnUi;
        renderUI(currentUiJson);
        playTurnAlertSound();

        // Reset all the temporary state variables for the next cycle
        localPlayerAnalysis = null;
        partnerPlayerAnalysis = null;
        bufferedNextTurnUi = null;
        partnerFinishedBuffering = false;

        setLoading(false);
    });

    if (!currentUiJson) {
        if(gameWrapper) gameWrapper.style.display = 'none';
        if(lobbyContainer) lobbyContainer.style.display = 'none';
        if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'block';
    }


    populateLobbySelector();

    joinLobbyButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            showError("API Key is required to connect.");
            return;
        }

        localStorage.setItem('sparksync_apiKey', apiKey);
        apiKeyLocked = true;
        hideError();
        if(lobbySelectionScreen) lobbySelectionScreen.style.display = 'none';
        lobbyContainer.style.display = 'block';

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
            },
            onRoomDataReceived: handleRoomDataReceived,
        });
    });

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
            switchToRoom(roomName, false);
            newRoomInput.value = '';
        }
    });

    const primaryApiKey = getPrimaryApiKey();
    const savedApiKey = localStorage.getItem('sparksync_apiKey');

    if (primaryApiKey && !hasPrimaryApiKeyFailed) {
        apiKeyInput.value = primaryApiKey;
        apiKeyInput.disabled = true;
        apiKeyInput.placeholder = "Using default key";
        console.log("Using primary API key.");
        joinLobbyButton.click();
    } else if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        console.log("Using saved API key.");
        joinLobbyButton.click();
    } else {
         console.log("No primary or saved key found. Waiting for user input.");
    }

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

    window.addEventListener('beforeunload', () => {
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
        if (spinnerResult) {
            spinnerResult.className = 'spinner-result'; // Reset classes
            spinnerResult.style.display = 'block';
            spinnerResult.innerHTML = '...';

            setTimeout(() => {
                spinnerResult.innerHTML = `Location: <strong>${finalResults[0]}</strong>`;
            }, 500);

            setTimeout(() => {
                spinnerResult.innerHTML += `<br>Vibe: <strong>${finalResults[1]}</strong>`;
            }, 1500);

            setTimeout(() => {
                spinnerResult.innerHTML += `<br>Wildcard: <strong>${finalResults[2]}</strong>`;
                spinnerResult.classList.add('final-result-pop'); // Add class for animation
            }, 2500);
        }

        // Hide modal and fire callback after the full reveal, with a longer delay
        setTimeout(() => {
            if (spinnerModal) spinnerModal.style.display = 'none';
            if (spinnerCompletionCallback) {
                spinnerCompletionCallback(finalResults);
            }
            activeSpinners = [];
        }, 6500); // Increased delay
    } else {
        console.error("Mismatch in spinner results. Aborting.");
        setTimeout(() => {
            if (spinnerModal) spinnerModal.style.display = 'none';
            if (spinnerCompletionCallback) {
                spinnerCompletionCallback([]);
            }
            activeSpinners = [];
        }, 2000);
    }
}

// Handler for incoming state updates from Player 1
function handleSpinnerStateUpdate(spinnersState) {
    if (amIPlayer1) return;

    spinnersState.forEach(state => {
        const localSpinner = activeSpinners.find(s => s.id === state.id);
        if (localSpinner) {
            localSpinner.angle = state.angle;
            localSpinner.isSpinning = state.isSpinning;
            localSpinner.result = state.result;
            localSpinner.wheelElement.style.transform = `rotate(${state.angle}rad)`;
        }
    });

    // If all have stopped, end the spinner on the client side
    if (spinnersState.every(s => !s.isSpinning)) {
        endSpinner();
    } else {
         // keep animation frame running
        requestAnimationFrame(runSpinnerAnimation);
    }
}

// Ensure DOM is fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeGame);
