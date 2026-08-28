import test from "node:test";
import assert from "node:assert/strict";

import {
	getActionsForInput,
	Hotkeys,
	rebuildInputActionLookup,
} from "../js/hotkeys.js";

test("reverse hotkey lookup preserves configured action order", () => {
	const prior = Hotkeys.bindings;
	Hotkeys.bindings = {
		moveUp: ["KeyQ"],
		shoot: ["KeyQ"],
		weapon1: ["Digit1"],
	};
	rebuildInputActionLookup();
	assert.deepEqual(getActionsForInput("KeyQ"), ["moveUp", "shoot"]);
	assert.deepEqual(getActionsForInput("Unknown"), []);
	Hotkeys.bindings = prior;
	rebuildInputActionLookup();
});
