'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let settingsPath = null;
let _settings = null;

const DEFAULTS = {
  libraryPath: null,           // null = not configured yet (triggers first-run)
  excludedFolders: [],         // user-defined folder names to skip
  backgroundImageUrl: '',      // custom grid background image URL
};

function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function load() {
  if (_settings) return _settings;
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    _settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    _settings = { ...DEFAULTS };
  }
  return _settings;
}

function save() {
  try {
    const p = getSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function getLibraryPath() {
  return load().libraryPath || null;
}

function setLibraryPath(p) {
  load();
  _settings.libraryPath = p ? p.replace(/\\/g, '/') : null;
  save();
}

function getExcludedFolders() {
  return load().excludedFolders || [];
}

function setExcludedFolders(arr) {
  load();
  _settings.excludedFolders = Array.isArray(arr) ? arr : [];
  save();
}

function getBackgroundImageUrl() {
  return load().backgroundImageUrl || '';
}

function setBackgroundImageUrl(url) {
  load();
  _settings.backgroundImageUrl = typeof url === 'string' ? url.trim() : '';
  save();
}

function getAll() {
  return { ...load() };
}

module.exports = { load, getLibraryPath, setLibraryPath, getExcludedFolders, setExcludedFolders, getBackgroundImageUrl, setBackgroundImageUrl, getAll };
