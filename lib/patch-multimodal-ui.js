// Runtime/build shared patch: add multimodal (image input) configuration fields
// to the bundled dsh Models settings UI for the llm-pi-ai provider.
//
// The upstream @deepseek-ai/dsh-client-ui-settings-models package intentionally
// keeps a small curated editor and does not yet expose the `input` /
// `defaultInput` fields that @deepseek-ai/dsh-llm-pi-ai already supports in
// settings.yaml.  Until that lands upstream, DSH Buddy applies this small patch
// to the installed client bundle so end users get a GUI instead of having to
// edit YAML by hand.
//
// This module is shared by the build pipeline (scripts/build-web-profile.js) and
// by the desktop app on startup so existing profiles also receive the UI without
// a manual file edit.

const fs = require('fs');
const path = require('path');

const TOP_LEVEL_HELPERS = `/**
 * Read a model entry's declared input modalities. An absent/empty list means
 * "inherit from the catalog or route default", matching llm-pi-ai's schema.
 */
function inputOf(model) {
	const value = model?.input;
	return Array.isArray(value) ? value : [];
}
function hasInput(model, modality) {
	return inputOf(model).includes(modality);
}
function toggleInputList(list, modality) {
	const current = Array.isArray(list) ? list : [];
	return current.includes(modality) ? current.filter((item) => item !== modality) : [...current, modality];
}
`;

const MODEL_TOGGLE_HELPER = `
			const toggleInput = (index, modality) => {
				patch(index, { input: toggleInputList(models[index]?.input, modality) });
			};
`;

// The per-model advanced area currently ends with the maxTokens field.  Insert
// an "Input modalities" checkbox group as the next field in that grid.
const MODEL_INPUT_JSX = `,
							(0, react_jsx_runtime.jsxs)("div", {
								className: ModelsSection_module_css_default["modelField"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ModelsSection_module_css_default["modelFieldLabel"],
									children: t("modelInput")
								}), (0, react_jsx_runtime.jsxs)("div", {
									style: { display: "flex", gap: "12px" },
									children: ["text", "image"].map((modality) => (0, react_jsx_runtime.jsxs)("label", {
										className: ModelsSection_module_css_default["modelFieldLabel"],
										children: [(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: hasInput(model, modality),
											disabled,
											onChange: () => { toggleInput(index, modality); }
										}), t(modality === "text" ? "inputText" : "inputImage")]
									}, modality))
								}), (0, react_jsx_runtime.jsx)("span", {
									className: ModelsSection_module_css_default["modelFieldLabel"],
									children: t("modelInputHint")
								})]
							})`;

// Route-level default input modalities for pi-ai providers.  This is inserted
// after the Base URL field in the "Customized settings" area of ProviderEditor.
const DEFAULT_INPUT_JSX = `,
							family === "pi-ai" ? (0, react_jsx_runtime.jsxs)("div", {
								className: ModelsSection_module_css_default["field"],
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ModelsSection_module_css_default["fieldLabel"],
									children: t("defaultInput")
								}), (0, react_jsx_runtime.jsxs)("div", {
									style: { display: "flex", gap: "12px" },
									children: ["text", "image"].map((modality) => (0, react_jsx_runtime.jsxs)("label", {
										className: ModelsSection_module_css_default["modelFieldLabel"],
										children: [(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: (Array.isArray(draft.defaultInput) ? draft.defaultInput : []).includes(modality),
											disabled,
											onChange: () => {
												const next = toggleInputList(draft.defaultInput, modality);
												setDraft((current) => next.length === 0 ? (0, _deepseek_ai_dsh_client_schema_form.deletePath)(current, ["defaultInput"]) : (0, _deepseek_ai_dsh_client_schema_form.setPath)(current, ["defaultInput"], next));
											}
										}), t(modality === "text" ? "inputText" : "inputImage")]
									}, modality))
								}), (0, react_jsx_runtime.jsx)("span", {
									className: ModelsSection_module_css_default["modelFieldLabel"],
									children: t("defaultInputHint")
								})]
							}) : null`;

function patchClient(source) {
	let patched = source;

	// 1. Add small modality helpers used by both the model list and provider editor.
	if (!patched.includes('function inputOf(model)')) {
		patched = patched.replace(
			/(function IconChevron\(\{ open \}\) \{)/,
			`${TOP_LEVEL_HELPERS}\n$1`
		);
	}

	// 2. Add toggleInput inside ModelListEditor, just before fetchModels.
	if (!patched.includes('const toggleInput = (index, modality) =>')) {
		patched = patched.replace(
			/(\n\s*const fetchModels = async \(\) => \{)/,
			`${MODEL_TOGGLE_HELPER}$1`
		);
	}

	// 3. Add per-model input modality checkboxes after the maxTokens field.
	if (!patched.includes('children: t("modelInput")')) {
		const modelInputPattern = /(\n\s*onChange: \(event\) => \{\n\s*editCapacity\(index, "maxTokens", event\.target\.value\);\n\s*\}\n\s*\}\)\]\n\s*\}\))(?=\])/;
		if (!modelInputPattern.test(patched)) {
			throw new Error('patch-multimodal-ui: could not locate the ModelListEditor maxTokens field');
		}
		patched = patched.replace(modelInputPattern, `$1${MODEL_INPUT_JSX}`);
	}

	// 4. Add route-level defaultInput after the Base URL field in ProviderEditor.
	if (!patched.includes('children: t("defaultInput")')) {
		const defaultInputPattern = /(\n\s*placeholder: family === "deepseek" \? DEEPSEEK_PUBLIC_BASE_URL : stringAt\(fallback, "baseURL"\) \?\? t\("baseUrlDefault"\),\n\s*"aria-label": t\("baseUrl"\),\n\s*disabled,\n\s*onChange: \(event\) => \{\n\s*setField\("baseURL", event\.target\.value === "" \? void 0 : event\.target\.value\);\n\s*\}\n\s*\}\)\]\n\s*\}\))(?=,\n\s*ownsIdentity \?)/;
		if (!defaultInputPattern.test(patched)) {
			throw new Error('patch-multimodal-ui: could not locate the ProviderEditor Base URL field');
		}
		patched = patched.replace(defaultInputPattern, `$1${DEFAULT_INPUT_JSX}`);
	}

	// 5. Add English copy used by the new controls.
	if (!patched.includes('modelInput: "Input modalities"')) {
		const enOld = 'modelMaxTokens: "Max output tokens",';
		if (!patched.includes(enOld)) {
			throw new Error('patch-multimodal-ui: could not locate the English modelMaxTokens copy');
		}
		patched = patched.replace(
			enOld,
			`${enOld}\n\t\t\tmodelInput: "Input modalities",\n\t\t\tmodelInputHint: "Leave all unchecked to use the provider/catalog default.",\n\t\t\tdefaultInput: "Default input modalities",\n\t\t\tdefaultInputHint: "Leave all unchecked to use the provider default.",\n\t\t\tinputText: "Text",\n\t\t\tinputImage: "Image",`
		);
	}

	// 6. Add Chinese copy used by the new controls.
	if (!patched.includes('modelInput: "输入模态"')) {
		const zhOld = 'modelMaxTokens: "最大输出 token",';
		if (!patched.includes(zhOld)) {
			throw new Error('patch-multimodal-ui: could not locate the Chinese modelMaxTokens copy');
		}
		patched = patched.replace(
			zhOld,
			`${zhOld}\n\t\t\tmodelInput: "输入模态",\n\t\t\tmodelInputHint: "全部不勾选时使用提供方/目录默认。",\n\t\t\tdefaultInput: "默认输入模态",\n\t\t\tdefaultInputHint: "全部不勾选时使用提供方默认。",\n\t\t\tinputText: "文本",\n\t\t\tinputImage: "图片",`
		);
	}

	return patched;
}

function patchFile(filePath) {
	const original = fs.readFileSync(filePath, 'utf8');
	const patched = patchClient(original);
	if (patched !== original) {
		// Write via a same-directory temp file and rename so a pnpm hard-linked
		// store entry is replaced instead of mutated in place.
		const tmp = `${filePath}.dsh-multimodal-patch`;
		fs.writeFileSync(tmp, patched);
		fs.renameSync(tmp, filePath);
	}
	return patched !== original;
}

function profileModelsUiPath(dshHome, profileName) {
	return path.join(
		dshHome,
		'profiles',
		profileName,
		'node_modules',
		'@deepseek-ai',
		'dsh-client-ui-settings-models',
		'lib',
		'client.js'
	);
}

function patchProfileUi({ dshHome, profileName }) {
	const filePath = profileModelsUiPath(dshHome, profileName);
	if (!fs.existsSync(filePath)) return false;
	return patchFile(filePath);
}

module.exports = { patchClient, patchFile, patchProfileUi, profileModelsUiPath };
