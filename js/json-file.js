// Shared JSON-file import helpers for the configuration editors.

export async function readJsonObjectFile(file, label = "JSON file") {
	if (!file) throw new Error(`No ${label} selected.`);
	if (Number(file.size) > 16 * 1024 * 1024) {
		throw new Error(`${label} exceeds the 16 MiB import limit.`);
	}

	let parsed;
	try {
		parsed = JSON.parse(await file.text());
	} catch (error) {
		throw new Error(`${label} contains invalid JSON: ${error.message}`);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${label} must contain one JSON object.`);
	}

	return parsed;
}
