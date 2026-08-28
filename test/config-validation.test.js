import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
	mergeConfig,
	validateCompleteConfig,
} from "../js/config.js";

const factory = JSON.parse(fs.readFileSync(new URL("../config.json", import.meta.url)));

test("factory configuration compiles completely", () => {
	assert.equal(validateCompleteConfig(factory, factory), factory);
});

test("unsafe and unknown root configuration fields are rejected", () => {
	assert.throws(
		() => mergeConfig({}, JSON.parse('{"__proto__":{"polluted":true}}')),
		/Unsafe configuration field/,
	);
	assert.throws(
		() => validateCompleteConfig({ ...factory, unknownSetting: 1 }, factory),
		/not recognised/,
	);
});
