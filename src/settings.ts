import { App, PluginSettingTab, Setting, moment } from "obsidian";
import { t } from "./i18n";
import type OnStagePlugin from "./main";

export type UpdateMode = "direct" | "calm" | "manual";
export type ThemeMode = "light" | "dark" | "auto";

export interface OnStageSettings {
	settingsVersion: number;
	splitLevel: number;
	cover: boolean;
	agenda: boolean;
	mode: UpdateMode;
	calmDelay: number;
	follow: boolean;
	captureClicker: boolean;
	editOnSlide: boolean;
	theme: ThemeMode;
	accent: string;
	fontFamily: string;
	fontSize: number;
	/** Projection zoom, changed with + / - / 0 in the projection window. */
	zoom: number;
	minScale: number;
	progress: boolean;
	coverFields: string;
	coverLabels: boolean;
	clickableLinks: boolean;
}

export const DEFAULT_SETTINGS: OnStageSettings = {
	settingsVersion: 4,
	splitLevel: 1,
	cover: true,
	agenda: true,
	mode: "calm",
	calmDelay: 1500,
	follow: true,
	captureClicker: true,
	editOnSlide: true,
	theme: "light",
	accent: "#3a5bd9",
	fontFamily: "",
	fontSize: 1,
	zoom: 1,
	minScale: 0.7,
	progress: true,
	coverFields: (moment.locale() || "en").toLowerCase().startsWith("fr")
		? "sous-titre, subtitle, auteur, author, date"
		: "subtitle, author, date",
	coverLabels: false,
	clickableLinks: true,
};

export class OnStageSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: OnStagePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
		};

		containerEl.createEl("p", { cls: "setting-item-description", text: t("sOverridesIntro") });

		new Setting(containerEl).setName(t("sSplit")).setHeading();

		new Setting(containerEl)
			.setName(t("sSplitLevel"))
			.setDesc(t("sSplitLevelDesc"))
			.addDropdown((d) =>
				d
					.addOption("1", "H1")
					.addOption("2", "H2")
					.addOption("3", "H3")
					.addOption("0", t("sSplitOnlyBreaks"))
					.setValue(String(s.splitLevel))
					.onChange(async (v) => {
						s.splitLevel = Number(v);
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sCover"))
			.setDesc(t("sCoverDesc"))
			.addToggle((tg) =>
				tg.setValue(s.cover).onChange(async (v) => {
					s.cover = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sCoverFields"))
			.setDesc(t("sCoverFieldsDesc"))
			.addTextArea((tx) =>
				tx.setValue(s.coverFields).onChange(async (v) => {
					s.coverFields = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sCoverLabels"))
			.setDesc(t("sCoverLabelsDesc"))
			.addToggle((tg) =>
				tg.setValue(s.coverLabels).onChange(async (v) => {
					s.coverLabels = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sAgenda"))
			.setDesc(t("sAgendaDesc"))
			.addToggle((tg) =>
				tg.setValue(s.agenda).onChange(async (v) => {
					s.agenda = v;
					await save();
				})
			);

		new Setting(containerEl).setName(t("sLive")).setHeading();

		new Setting(containerEl)
			.setName(t("sMode"))
			.setDesc(t("sModeDesc"))
			.addDropdown((d) =>
				d
					.addOption("calm", t("sModeCalm"))
					.addOption("direct", t("sModeDirect"))
					.addOption("manual", t("sModeManual"))
					.setValue(s.mode)
					.onChange(async (v) => {
						s.mode = v as UpdateMode;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sDelay"))
			.setDesc(t("sDelayDesc"))
			.addSlider((sl) =>
				sl
					.setLimits(300, 4000, 100)
					.setValue(s.calmDelay)
					.onChange(async (v) => {
						s.calmDelay = v;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sFollow"))
			.setDesc(t("sFollowDesc"))
			.addToggle((tg) =>
				tg.setValue(s.follow).onChange(async (v) => {
					s.follow = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sClicker"))
			.setDesc(t("sClickerDesc"))
			.addToggle((tg) =>
				tg.setValue(s.captureClicker).onChange(async (v) => {
					s.captureClicker = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sEdit"))
			.setDesc(t("sEditDesc"))
			.addToggle((tg) =>
				tg.setValue(s.editOnSlide).onChange(async (v) => {
					s.editOnSlide = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName(t("sLinks"))
			.setDesc(t("sLinksDesc"))
			.addToggle((tg) =>
				tg.setValue(s.clickableLinks).onChange(async (v) => {
					s.clickableLinks = v;
					await save();
				})
			);

		new Setting(containerEl).setName(t("sLook")).setHeading();

		new Setting(containerEl).setName(t("sTheme")).addDropdown((d) =>
			d
				.addOption("light", t("sThemeLight"))
				.addOption("dark", t("sThemeDark"))
				.addOption("auto", t("sThemeAuto"))
				.setValue(s.theme)
				.onChange(async (v) => {
					s.theme = v as ThemeMode;
					await save();
				})
		);

		new Setting(containerEl).setName(t("sAccent")).addColorPicker((c) =>
			c.setValue(s.accent).onChange(async (v) => {
				s.accent = v;
				await save();
			})
		);

		new Setting(containerEl)
			.setName(t("sFont"))
			.setDesc(t("sFontDesc"))
			.addText((tx) =>
				tx
					.setPlaceholder("Inter, Helvetica Neue")
					.setValue(s.fontFamily)
					.onChange(async (v) => {
						s.fontFamily = v;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sFontSize"))
			.setDesc(t("sFontSizeDesc"))
			.addSlider((sl) =>
				sl
					.setLimits(0.6, 2, 0.05)
					.setValue(s.fontSize)
					.onChange(async (v) => {
						s.fontSize = v;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sMinScale"))
			.setDesc(t("sMinScaleDesc"))
			.addSlider((sl) =>
				sl
					.setLimits(0.4, 1, 0.05)
					.setValue(s.minScale)
					.onChange(async (v) => {
						s.minScale = v;
						await save();
					})
			);

		new Setting(containerEl)
			.setName(t("sProgress"))
			.setDesc(t("sProgressDesc"))
			.addToggle((tg) =>
				tg.setValue(s.progress).onChange(async (v) => {
					s.progress = v;
					await save();
				})
			);
	}
}
