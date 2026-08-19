// IndexedDB-backed handoff between gameplay, the replay setup menu, and the
// dedicated replay player. Replays can be much larger than local/sessionStorage.

const DATABASE_NAME = "demoReplayStore";
const DATABASE_VERSION = 1;
const STORE_NAME = "replays";
const ACTIVE_REPLAY_KEY = "activeReplay";

function openDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onerror = () => reject(request.error || new Error("Could not open replay database."));
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
	});
}

async function withStore(mode, operation) {
	const database = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, mode);
			const store = transaction.objectStore(STORE_NAME);
			let request;
			try {
				request = operation(store);
			} catch (error) {
				reject(error);
				return;
			}
			request.onerror = () => reject(request.error || new Error("Replay database operation failed."));
			request.onsuccess = () => resolve(request.result);
		});
	} finally {
		database.close();
	}
}

export function saveActiveReplay(replay) {
	return withStore("readwrite", (store) => store.put(replay, ACTIVE_REPLAY_KEY));
}

export function loadActiveReplay() {
	return withStore("readonly", (store) => store.get(ACTIVE_REPLAY_KEY));
}

export function clearActiveReplay() {
	return withStore("readwrite", (store) => store.delete(ACTIVE_REPLAY_KEY));
}
