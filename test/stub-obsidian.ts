import YAML from "yaml";
import moment from "moment";
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class ItemView {}
export class Component {}
export class Notice {}
export class Scope {}
export class MarkdownView {}
export class TFile {}
export const MarkdownRenderer = {};
export const editorInfoField = {};
export function setIcon() {}
export function finishRenderMath() {}
export function parseYaml(s: string) { return YAML.parse(s); }
export { moment };
export function getAllTags() { return null; }
export function prepareFuzzySearch() { return () => null; }
export const Platform = { isMacOS: true };
