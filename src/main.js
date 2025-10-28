/**
 * Insertive Plugin for Obsidian
 * 
 * A simple text snippet management plugin that provides:
 * - Dynamic snippet creation and management through settings interface
 * - Template support with {1}, {2}, etc. placeholders for selected text
 * - Multiple insertion methods: command palette, keybinds, and context menu
 * - Custom Lucide icons for visual distinction
 * - Group organization with submenu support
 * - Search and drag-to-reorder functionality
 * 
 * @author Garin Wally
 * @version 1.0.0-beta.1
 * @license MIT
 */

const { Plugin, Notice, PluginSettingTab, Modal, Setting } = require('obsidian');

// Plugin constants
const CONSTANTS = {
    COMMAND_PREFIX: 'insert-snippet-',
    DEFAULT_ICON: 'stamp',
    ICON_PREVIEW_DEBOUNCE: 150,
    DEFAULT_SETTINGS: {
        snippets: {
            "hello": "_Hello World_",
            "greet": "Hello {1} (from Insertive)"
        },
        icons: {
            "hello": "stamp",
            "greet": "hand"
        },
        groups: {
            "hello": "",
            "greet": ""
        }
    }
};

// DEBUG MODE - show non-warning/error notificaitions
const DEBUG = false;


/**
 * Utility functions for snippet validation and processing
 */
class SnippetValidator {
    /**
     * Validate snippet key for safety and uniqueness
     * @param {string} key - The snippet key to validate
     * @returns {{isValid: boolean, message: string}} Validation result
     */
    static validateKey(key) {
        if (!key || key.trim() === '') {
            return { isValid: false, message: 'Snippet key cannot be empty.' };
        }

        if (key.includes(' ')) {
            return { isValid: false, message: 'Snippet key cannot contain spaces.' };
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
            return { isValid: false, message: 'Snippet key can only contain letters, numbers, hyphens, and underscores.' };
        }

        return { isValid: true, message: '' };
    }
}

/**
 * Utility class for processing snippet templates with placeholders
 */
class SnippetProcessor {
    /**
     * Process a snippet template with selected text using {n} placeholders
     * 
     * @param {string} snippetText - The snippet template containing {1}, {2}, etc.
     * @param {string} selectedText - The selected text to use for replacements
     * @returns {string} The processed snippet text with replacements applied
     * 
     * @example
     * // Single line replacement
     * processTemplate("Hello, {1}!", "John Doe") // "Hello, John Doe!"
     * 
     * @example  
     * // Multi-line individual replacement
     * processTemplate("- {1}\n- {2}", "one\ntwo") // "- one\n- two"
     * 
     * @example
     * // Multi-line grouped replacement  
     * processTemplate("> {1}\n> {2}", "Hello\nworld\ntest") // "> Hello\n> world test"
     */
    static processTemplate(snippetText, selectedText) {
        if (!selectedText || !this.hasPlaceholders(snippetText)) {
            return snippetText;
        }

        const lines = selectedText.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        const placeholders = this.extractPlaceholders(snippetText);
        let processedText = snippetText;

        placeholders.forEach(placeholder => {
            const paramNum = parseInt(placeholder.replace(/[{}]/g, ''), 10);
            let replacement = '';

            if (paramNum === 1) {
                replacement = lines.length > 0 ? lines[0] : '';
            } else if (paramNum > 1 && paramNum <= lines.length) {
                replacement = lines[paramNum - 1];
            } else if (paramNum === 2 && lines.length > 1) {
                replacement = lines.slice(1).join(' ');
            }

            const regex = new RegExp('\\{' + paramNum + '\\}', 'g');
            processedText = processedText.replace(regex, replacement);
        });

        return processedText;
    }

    /**
     * Check if snippet text contains {n} placeholders
     * @param {string} text - The text to check
     * @returns {boolean} True if placeholders are found
     */
    static hasPlaceholders(text) {
        return /\{\d+\}/.test(text);
    }

    /**
     * Extract all unique placeholders from snippet text
     * @param {string} text - The snippet text
     * @returns {string[]} Array of unique placeholders like ["{1}", "{2}"]
     */
    static extractPlaceholders(text) {
        const matches = text.match(/\{\d+\}/g);
        return matches ? [...new Set(matches)] : [];
    }
}

/**
 * Utility class for rendering Lucide icons with live preview support
 */
class IconRenderer {
    /**
     * Render a Lucide icon in the provided element using Obsidian's setIcon
     * @param {HTMLElement} element - The element to render the icon in
     * @param {string} iconName - The Lucide icon name
     */
    static renderIcon(element, iconName) {
        if (!iconName || !element) return;
        
        try {
            const { setIcon } = require('obsidian');
            setIcon(element, iconName);
        } catch (error) {
            console.warn('IconRenderer: Failed to render icon:', iconName, error);
            element.textContent = '#';
        }
    }

    /**
     * Create a debounced function to prevent excessive API calls
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    static debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }
}

/**
 * Command manager for handling dynamic snippet commands
 * Manages registration and cleanup of snippet-specific commands
 */
class CommandManager {
    /**
     * @param {InsertivePlugin} plugin - The main plugin instance
     */
    constructor(plugin) {
        this.plugin = plugin;
        this.registeredCommands = new Set();
    }

    /**
     * Register commands for all current snippets
     * Clears existing commands first to avoid duplicates
     */
    registerSnippetCommands() {
        this.clearSnippetCommands();

        Object.keys(this.plugin.settings.snippets).forEach(key => {
            this.registerSnippetCommand(key);
        });
    }

    /**
     * Register a single snippet command with template processing
     * @param {string} snippetKey - The key of the snippet to create a command for
     */
    registerSnippetCommand(snippetKey) {
        const commandId = CONSTANTS.COMMAND_PREFIX + snippetKey;
        this.registeredCommands.add(commandId);
        
        this.plugin.addCommand({
            id: commandId,
            name: `Insert Snippet: ${snippetKey}`,
            editorCallback: (editor) => {
                const selectedText = editor.getSelection();
                const snippetText = this.plugin.settings.snippets[snippetKey];
                const processedText = SnippetProcessor.processTemplate(snippetText, selectedText);
                
                editor.replaceSelection(processedText);
                if(DEBUG){
                    new Notice(`Inserted: ${snippetKey}`);
                }
            }
        });
    }

    /**
     * Clear all registered snippet commands
     * Called during plugin unload and command re-registration
     */
    clearSnippetCommands() {
        this.registeredCommands.forEach(commandId => {
            delete this.plugin.app.commands.commands[commandId];
        });
        this.registeredCommands.clear();
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.clearSnippetCommands();
        this.registeredCommands = null;
        this.plugin = null;
    }
}

/**
 * Context menu manager for handling right-click menu integration
 * Provides snippet insertion through editor context menu
 */
class ContextMenuManager {
    /**
     * @param {InsertivePlugin} plugin - The main plugin instance
     */
    constructor(plugin) {
        this.plugin = plugin;
    }

    /**
     * Add Insertive submenu to the editor context menu with group support
     * @param {Menu} menu - The Obsidian menu object
     * @param {Editor} editor - The current editor instance
     */
    addContextMenu(menu, editor) {
        const snippetKeys = Object.keys(this.plugin.settings.snippets);
        
        if (snippetKeys.length === 0) {
            menu.addItem((item) => {
                item.setTitle("Insertive")
                    .setIcon("file-down")
                    .setDisabled(true);
            });
            return;
        }

        menu.addItem((item) => {
            item.setTitle("Insertive").setIcon("text-cursor-input");
            
            const submenu = item.setSubmenu();
            
            // Organize snippets by group (preserving order)
            const groupedSnippets = this.organizeSnippetsByGroup(snippetKeys);
            
            // Add ungrouped snippets first (in settings order, not sorted)
            if (groupedSnippets[''] && groupedSnippets[''].length > 0) {
                groupedSnippets[''].forEach((key) => {
                    this.addSnippetMenuItem(submenu, key, editor);
                });
                
                // Add separator if there are also grouped snippets
                const hasGroups = Object.keys(groupedSnippets).some(g => g !== '');
                if (hasGroups) {
                    submenu.addSeparator();
                }
            }
            
            // Add grouped snippets (groups sorted alphabetically, snippets in settings order)
            const groups = Object.keys(groupedSnippets).filter(g => g !== '').sort();
            groups.forEach((groupName) => {
                submenu.addItem((groupItem) => {
                    groupItem.setTitle(groupName).setIcon("folder");
                    
                    const groupSubmenu = groupItem.setSubmenu();
                    
                    // Add snippets in this group (in settings order, not sorted)
                    groupedSnippets[groupName].forEach((key) => {
                        this.addSnippetMenuItem(groupSubmenu, key, editor);
                    });
                });
            });
            
            // Add management options
            submenu.addSeparator();
            submenu.addItem((subitem) => {
                subitem.setTitle("Manage Snippets...")
                       .setIcon("settings")
                       .onClick(() => {
                           this.plugin.app.setting.open();
                           this.plugin.app.setting.openTabById(this.plugin.manifest.id);
                       });
            });
        });
    }

    /**
     * Organize snippets by their group (preserving order within groups)
     * @param {string[]} snippetKeys - Array of snippet keys in settings order
     * @returns {Object} Object with group names as keys and arrays of snippet keys as values
     */
    organizeSnippetsByGroup(snippetKeys) {
        const grouped = {};
        
        snippetKeys.forEach(key => {
            const group = this.plugin.settings.groups?.[key] || '';
            if (!grouped[group]) {
                grouped[group] = [];
            }
            grouped[group].push(key);
        });
        
        return grouped;
    }

    /**
     * Add a single snippet menu item
     * @param {Menu} menu - The menu to add the item to
     * @param {string} key - The snippet key
     * @param {Editor} editor - The editor instance
     */
    addSnippetMenuItem(menu, key, editor) {
        menu.addItem((subitem) => {
            const icon = this.plugin.settings.icons?.[key] || CONSTANTS.DEFAULT_ICON;
            subitem.setTitle(key)
                   .setIcon(icon)
                   .onClick(() => {
                       const selectedText = editor.getSelection();
                       const snippetText = this.plugin.settings.snippets[key];
                       const processedText = SnippetProcessor.processTemplate(snippetText, selectedText);
                       
                       editor.replaceSelection(processedText);
                        if(DEBUG){
                            new Notice(`Inserted: ${snippetKey}`);
                        }
                   });
        });
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.plugin = null;
    }
}

/**
 * Confirmation modal for overwriting snippets
 */
class ConfirmModal extends Modal {
    /**
     * @param {object} app - Obsidian app instance
     * @param {string} message - The confirmation message
     * @param {Function} onConfirm - Callback when confirmed
     */
    constructor(app, message, onConfirm) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('p', { text: this.message });

        const buttonContainer = contentEl.createDiv('modal-button-container');
        buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;';
        
        buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel'
        }).addEventListener('click', () => this.close());

        buttonContainer.createEl('button', {
            text: 'Replace',
            cls: 'mod-cta'
        }).addEventListener('click', async () => {
            this.close();
            if (this.onConfirm) await this.onConfirm();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Modal for editing existing snippets with live icon preview
 * Provides comprehensive editing interface for snippet configuration
 */
class EditSnippetModal extends Modal {
    /**
     * @param {object} app - Obsidian app instance
     * @param {InsertivePlugin} plugin - Plugin instance
     * @param {string} originalKey - Original snippet key
     * @param {string} originalValue - Original snippet value
     * @param {InsertiveSettingTab} settingTab - Settings tab for refreshing display
     */
    constructor(app, plugin, originalKey, originalValue, settingTab) {
        super(app);
        this.plugin = plugin;
        this.originalKey = originalKey;
        this.settingTab = settingTab;
        
        // Editable values
        this.key = originalKey;
        this.value = originalValue;
        this.icon = plugin.settings.icons?.[originalKey] || CONSTANTS.DEFAULT_ICON;
        this.group = plugin.settings.groups?.[originalKey] || '';
        
        // UI elements for cleanup
        this.iconPreviewEl = null;
        this.updateIconPreview = null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Edit Snippet' });

        this.createFormElements(contentEl);
        this.createActionButtons(contentEl);
    }

    /**
     * Create form input elements
     * @param {HTMLElement} contentEl - Content element container
     */
    createFormElements(contentEl) {
        // Key input
        new Setting(contentEl)
            .setName('Snippet Key')
            .setDesc('The unique identifier for this snippet')
            .addText(text => text
                .setValue(this.key)
                .onChange((value) => {
                    this.key = value;
                }));

        // Value input with template explanation
        new Setting(contentEl)
            .setName('Snippet Text')
            .setDesc('The text content of the snippet. Use {1}, {2}, etc. for placeholders.')
            .addTextArea(text => {
                text.setValue(this.value)
                    .onChange((value) => {
                        this.value = value;
                    });
                text.inputEl.rows = 6;
                text.inputEl.cols = 50;
                return text;
            });

        // Group input
        new Setting(contentEl)
            .setName('Group')
            .setDesc('Optional group name for organizing snippets in the context menu (leave empty for no group)')
            .addText(text => text
                .setPlaceholder('e.g., "Examples" or "Templates"')
                .setValue(this.group)
                .onChange((value) => {
                    this.group = value;
                }));

        // Icon input with live preview
        this.createIconInput(contentEl);
    }

    /**
     * Create icon input with live preview functionality
     * @param {HTMLElement} contentEl - Content element container
     */
    createIconInput(contentEl) {
        new Setting(contentEl)
            .setName('Icon')
            .setDesc('Lucide icon name for the context menu (e.g., "stamp", "file-text", "star", "heart")')
            .addText(text => {
                text.setPlaceholder('stamp')
                    .setValue(this.icon)
                    .onChange((value) => {
                        this.icon = value || CONSTANTS.DEFAULT_ICON;
                        if (this.updateIconPreview) {
                            this.updateIconPreview(this.icon);
                        }
                    });
                
                // Create icon preview container
                const iconPreviewContainer = text.inputEl.parentElement;
                this.iconPreviewEl = iconPreviewContainer.createSpan({ 
                    cls: 'icon-preview',
                    attr: { 'aria-label': 'Icon preview' }
                });
                this.iconPreviewEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 20px;
                    height: 20px;
                    margin-left: 8px;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 3px;
                    background: var(--background-secondary);
                `;
                
                // Setup debounced icon preview update
                this.updateIconPreview = IconRenderer.debounce((iconName) => {
                    if (this.iconPreviewEl) {
                        this.iconPreviewEl.empty();
                        IconRenderer.renderIcon(this.iconPreviewEl, iconName);
                    }
                }, CONSTANTS.ICON_PREVIEW_DEBOUNCE);
                
                // Initial preview
                this.updateIconPreview(this.icon);
                
                return text;
            });
    }

    /**
     * Create action buttons (Save/Cancel)
     * @param {HTMLElement} contentEl - Content element container
     */
    createActionButtons(contentEl) {
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Save')
                .setCta()
                .onClick(() => this.handleSave()))
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    /**
     * Handle saving the edited snippet with validation and atomic update
     */
    async handleSave() {
        if (!this.key || !this.value) {
            new Notice('Please enter both a key and text value.');
            return;
        }

        // Validate key if it changed
        if (this.key !== this.originalKey) {
            const validation = SnippetValidator.validateKey(this.key);
            if (!validation.isValid) {
                new Notice(validation.message);
                return;
            }

            // Check if new key already exists
            if (this.plugin.settings.snippets[this.key]) {
                new Notice(`Snippet "${this.key}" already exists. Choose a different key.`);
                return;
            }
        }

        // Create new settings object to avoid partial writes (atomic update)
        const newSettings = { ...this.plugin.settings };
        newSettings.snippets = { ...newSettings.snippets };
        newSettings.icons = { ...newSettings.icons };
        newSettings.groups = { ...newSettings.groups };

        // Remove old key
        delete newSettings.snippets[this.originalKey];
        delete newSettings.icons[this.originalKey];
        delete newSettings.groups[this.originalKey];

        // Add new key
        newSettings.snippets[this.key] = this.value;
        newSettings.icons[this.key] = this.icon;
        newSettings.groups[this.key] = this.group;

        // Apply and save atomically
        this.plugin.settings = newSettings;
        await this.plugin.saveSettings();

        new Notice(`Updated snippet: ${this.key}`);
        this.close();
        this.settingTab.display();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Clean up references
        this.iconPreviewEl = null;
        this.updateIconPreview = null;
    }
}

/**
 * Settings tab for managing snippets within Obsidian's settings panel
 * Provides comprehensive snippet management interface
 */
class InsertiveSettingTab extends PluginSettingTab {
    /**
     * @param {object} app - Obsidian app instance
     * @param {InsertivePlugin} plugin - Plugin instance
     */
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        
        // Form state for new snippet creation
        this.newSnippetForm = {
            key: '',
            value: ''
        };
        
        // Container for filtered snippet list
        this.snippetsListContainer = null;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Insertive Plugin Settings' });
        
        this.renderNewSnippetSection(containerEl);
        
        // Rebuild list container
        this.snippetsListContainer = null;
        this.renderExistingSnippetsSection(containerEl);
    }

    /**
     * Render the section for adding new snippets
     * @param {HTMLElement} containerEl - The container element
     */
    renderNewSnippetSection(containerEl) {
        containerEl.createEl('h3', { text: 'Add New Snippet' });
        
        // Add template explanation
        containerEl.createDiv('setting-item-description', (el) => {
            el.innerHTML = 'You can use placeholders like <code>{1}</code>, <code>{2}</code>, etc. in your snippets. When you select text and insert a snippet with placeholders, the selected text will be split by newlines and inserted at the numbered positions.';
        });
        
        // Snippet key input
        new Setting(containerEl)
            .setName('Snippet Key')
            .setDesc('Enter a unique key for your snippet (letters, numbers, hyphens, and underscores only)')
            .addText(text => text
                .setPlaceholder('e.g., "email-intro"')
                .setValue(this.newSnippetForm.key)
                .onChange((value) => {
                    this.newSnippetForm.key = value;
                }));

        // Snippet value input
        new Setting(containerEl)
            .setName('Snippet Text')
            .setDesc('Enter the text content for your snippet. Use {1}, {2}, etc. for placeholders.')
            .addTextArea(text => {
                text.setPlaceholder('Enter your text snippet here...\nExample: "Hello, {1}! Welcome to {2}."')
                    .setValue(this.newSnippetForm.value)
                    .onChange((value) => {
                        this.newSnippetForm.value = value;
                    });
                text.inputEl.rows = 4;
                text.inputEl.cols = 50;
                return text;
            });

        // Add snippet button
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add Snippet')
                .setCta()
                .onClick(() => this.handleAddSnippet()));
    }

    /**
     * Render the section showing existing snippets with search
     * @param {HTMLElement} containerEl - The container element
     */
    renderExistingSnippetsSection(containerEl) {
        containerEl.createEl('h3', { text: 'Existing Snippets' });
        
        // Search bar
        let searchTerm = '';
        new Setting(containerEl)
            .setName('Search snippets')
            .addText(text => text
                .setPlaceholder('Filter by key or content...')
                .onChange(value => {
                    searchTerm = value.toLowerCase();
                    this.filterAndDisplaySnippets(this.snippetsListContainer, searchTerm);
                }));

        // Container for filtered results
        this.snippetsListContainer = containerEl.createDiv();
        this.filterAndDisplaySnippets(this.snippetsListContainer, '');
        this.enableDragToReorder(this.snippetsListContainer);
    }

    /**
     * Filter and display snippets based on search term
     * @param {HTMLElement} container - The container to render into
     * @param {string} term - The search term
     */
    filterAndDisplaySnippets(container, term) {
        container.empty();
        const keys = Object.keys(this.plugin.settings.snippets);

        if (keys.length === 0) {
            container.createEl('p', { text: 'No snippets configured yet.' });
            return;
        }

        const filtered = term 
            ? keys.filter(key => 
                  key.toLowerCase().includes(term) || 
                  this.plugin.settings.snippets[key].toLowerCase().includes(term)
              )
            : keys;

        if (filtered.length === 0) {
            container.createEl('p', { text: 'No snippets match your search.' });
            return;
        }

        // Usage instructions (only if not searching)
        if (!term) {
            this.renderUsageInstructions(container);
        }

        filtered.forEach(key => this.renderSnippetSetting(container, key));

        if (!term) {
            this.renderHotkeyInstructions(container);
        }
    }

    /**
     * Enable drag-to-reorder functionality for snippets
     * @param {HTMLElement} containerEl - The container element
     */
    enableDragToReorder(containerEl) {
        let draggedItem = null;

        containerEl.addEventListener('dragstart', (e) => {
            const settingItem = e.target.closest('.setting-item');
            if (!settingItem) return;
            draggedItem = settingItem;
            e.dataTransfer.effectAllowed = 'move';
            settingItem.style.opacity = '0.5';
        });

        containerEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        containerEl.addEventListener('dragenter', (e) => {
            const target = e.target.closest('.setting-item');
            if (target && target !== draggedItem) {
                target.classList.add('drag-over');
            }
        });

        containerEl.addEventListener('dragleave', (e) => {
            const target = e.target.closest('.setting-item');
            if (target) target.classList.remove('drag-over');
        });

        containerEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            const target = e.target.closest('.setting-item');
            if (!target || !draggedItem || target === draggedItem) return;

            target.classList.remove('drag-over');
            draggedItem.style.opacity = '1';

            const allItems = Array.from(containerEl.querySelectorAll('.setting-item'));
            const fromIndex = allItems.indexOf(draggedItem);
            const toIndex = allItems.indexOf(target);

            if (fromIndex === toIndex) return;

            // Reorder in settings
            const keys = Object.keys(this.plugin.settings.snippets);
            const [movedKey] = keys.splice(fromIndex, 1);
            keys.splice(toIndex, 0, movedKey);

            const newSnippets = {};
            const newIcons = {};
            const newGroups = {};
            keys.forEach(k => {
                newSnippets[k] = this.plugin.settings.snippets[k];
                newIcons[k] = this.plugin.settings.icons[k];
                newGroups[k] = this.plugin.settings.groups[k];
            });

            this.plugin.settings.snippets = newSnippets;
            this.plugin.settings.icons = newIcons;
            this.plugin.settings.groups = newGroups;

            await this.plugin.saveSettings();
            this.display(); // Refresh
        });

        containerEl.addEventListener('dragend', () => {
            containerEl.querySelectorAll('.setting-item').forEach(el => {
                el.style.opacity = '1';
                el.classList.remove('drag-over');
            });
        });
    }

    /**
     * Render usage instructions for snippets
     * @param {HTMLElement} containerEl - The container element
     */
    renderUsageInstructions(containerEl) {
        containerEl.createDiv('setting-item-description', (el) => {
            el.innerHTML = 'Each snippet automatically gets a command that can be assigned a hotkey. Go to <strong>Settings → Hotkeys</strong> and search for "Insert Snippet" to assign keyboard shortcuts.';
        });
    }

    /**
     * Render a single snippet setting row
     * @param {HTMLElement} containerEl - The container element
     * @param {string} key - The snippet key
     */
    renderSnippetSetting(containerEl, key) {
        const snippetValue = this.plugin.settings.snippets[key];
        const snippetGroup = this.plugin.settings.groups?.[key] || '';
        const truncatedValue = snippetValue.length > 100 
            ? snippetValue.substring(0, 100) + "..." 
            : snippetValue;

        const setting = new Setting(containerEl)
            .setName(key)
            .setDesc(truncatedValue);
        
        // Make the setting item draggable
        setting.settingEl.setAttribute('draggable', 'true');
        
        // Add group information if it exists
        if (snippetGroup) {
            setting.descEl.createEl('br');
            setting.descEl.createEl('small', { 
                text: `Group: ${snippetGroup}`,
                cls: 'mod-muted'
            });
        }
        
        // Add command information
        setting.descEl.createEl('br');
        setting.descEl.createEl('small', { 
            text: `Command: "Insert Snippet: ${key}"`,
            cls: 'mod-muted'
        });
        
        // Add action buttons
        setting.addButton(button => button
                .setButtonText('Edit')
                .onClick(() => {
                    new EditSnippetModal(this.app, this.plugin, key, snippetValue, this).open();
                }))
            .addButton(button => button
                .setButtonText('Delete')
                .setWarning()
                .onClick(() => this.handleDeleteSnippet(key)));
    }

    /**
     * Render instructions for setting up hotkeys
     * @param {HTMLElement} containerEl - The container element
     */
    renderHotkeyInstructions(containerEl) {
        containerEl.createEl('h4', { text: 'Setting up Hotkeys' });
        containerEl.createDiv('setting-item-description', (el) => {
            el.innerHTML = `
                <p>To assign hotkeys to your snippets:</p>
                <ol>
                    <li>Go to <strong>Settings → Hotkeys</strong></li>
                    <li>Search for "Insert Snippet"</li>
                    <li>Find the snippet you want to bind</li>
                    <li>Click the + button and press your desired key combination</li>
                </ol>
                <p><em>Example: Bind Ctrl+Shift+H to quickly insert your "hello" snippet</em></p>
            `;
        });
    }

    /**
     * Handle adding a new snippet with validation and overwrite confirmation
     */
    async handleAddSnippet() {
        const { key, value } = this.newSnippetForm;
        
        if (!key || !value) {
            new Notice('Please enter both a key and text value for the snippet.');
            return;
        }

        // Validate snippet key
        const validation = SnippetValidator.validateKey(key);
        if (!validation.isValid) {
            new Notice(validation.message);
            return;
        }

        // If key exists, ask for confirmation
        if (this.plugin.settings.snippets[key]) {
            new ConfirmModal(this.app, 
                `Snippet "${key}" already exists. Replace it?`,
                async () => {
                    await this.replaceSnippet(key, value);
                }
            ).open();
            return;
        }

        await this.addNewSnippet(key, value);
    }

    /**
     * Add a brand new snippet (no overwrite)
     * @param {string} key - The snippet key
     * @param {string} value - The snippet value
     */
    async addNewSnippet(key, value) {
        this.plugin.settings.snippets[key] = value;
        if (!this.plugin.settings.icons) this.plugin.settings.icons = {};
        this.plugin.settings.icons[key] = CONSTANTS.DEFAULT_ICON;
        if (!this.plugin.settings.groups) this.plugin.settings.groups = {};
        this.plugin.settings.groups[key] = '';

        await this.plugin.saveSettings();
        new Notice(`Added snippet: ${key}`);
        this.resetAndRefresh();
    }

    /**
     * Replace existing snippet
     * @param {string} key - The snippet key
     * @param {string} value - The snippet value
     */
    async replaceSnippet(key, value) {
        this.plugin.settings.snippets[key] = value;
        // Keep existing icon and group
        await this.plugin.saveSettings();
        new Notice(`Replaced snippet: ${key}`);
        this.resetAndRefresh();
    }

    /**
     * Reset form and refresh display
     */
    resetAndRefresh() {
        this.newSnippetForm = { key: '', value: '' };
        this.display();
    }

    /**
     * Handle deleting a snippet with cleanup
     * @param {string} key - The snippet key to delete
     */
    async handleDeleteSnippet(key) {
        delete this.plugin.settings.snippets[key];
        // Also delete the icon setting
        if (this.plugin.settings.icons && this.plugin.settings.icons[key]) {
            delete this.plugin.settings.icons[key];
        }
        // Also delete the group setting
        if (this.plugin.settings.groups && this.plugin.settings.groups[key]) {
            delete this.plugin.settings.groups[key];
        }
        await this.plugin.saveSettings();
        new Notice(`Deleted snippet: ${key}`);
        this.display();
    }
}

/**
 * Main plugin class
 * Coordinates all plugin functionality and manages component lifecycle
 */
class InsertivePlugin extends Plugin {
    /**
     * Plugin initialization
     * Sets up all managers, loads settings, and registers UI components
     */
    async onload() {
        console.log('Insertive plugin loading...');
        
        try {
            // Initialize managers
            this.commandManager = new CommandManager(this);
            this.contextMenuManager = new ContextMenuManager(this);
            
            // Load settings
            await this.loadSettings();
            
            // Register UI components
            this.registerUIComponents();
            
            // Register dynamic commands
            this.commandManager.registerSnippetCommands();
            
            console.log('Insertive plugin loaded successfully');
        } catch (error) {
            console.error('Insertive plugin failed to load:', error);
            new Notice('Failed to load Insertive plugin');
        }
    }

    /**
     * Register all UI components (settings tab and context menu)
     */
    registerUIComponents() {
        // Add settings tab
        this.addSettingTab(new InsertiveSettingTab(this.app, this));

        // Register context menu handler
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                this.contextMenuManager.addContextMenu(menu, editor);
            })
        );
    }

    /**
     * Load plugin settings from Obsidian's data store with validation
     */
    async loadSettings() {
        try {
            const loadedData = await this.loadData();
            this.settings = Object.assign({}, CONSTANTS.DEFAULT_SETTINGS, loadedData);
            
            // Ensure icons object exists for backward compatibility
            if (!this.settings.icons) {
                this.settings.icons = {};
                // Initialize icons for existing snippets
                Object.keys(this.settings.snippets).forEach(key => {
                    this.settings.icons[key] = CONSTANTS.DEFAULT_ICON;
                });
                await this.saveData(this.settings);
            }
            
            // Ensure groups object exists for backward compatibility
            if (!this.settings.groups) {
                this.settings.groups = {};
                // Initialize groups for existing snippets (empty string = no group)
                Object.keys(this.settings.snippets).forEach(key => {
                    this.settings.groups[key] = '';
                });
                await this.saveData(this.settings);
            }
        } catch (error) {
            console.error('Insertive: Error loading settings:', error);
            this.settings = { ...CONSTANTS.DEFAULT_SETTINGS };
        }
    }

    /**
     * Save plugin settings and update related components
     */
    async saveSettings() {
        try {
            await this.saveData(this.settings);
            
            // Re-register commands to reflect changes
            this.commandManager.registerSnippetCommands();
        } catch (error) {
            console.error('Insertive: Error saving settings:', error);
            new Notice('Failed to save Insertive settings');
        }
    }

    /**
     * Plugin cleanup with proper memory management
     */
    onunload() {
        console.log('Insertive plugin unloading...');
        
        // Clean up managers
        if (this.commandManager) {
            this.commandManager.destroy();
            this.commandManager = null;
        }
        
        if (this.contextMenuManager) {
            this.contextMenuManager.destroy();
            this.contextMenuManager = null;
        }
        
        // Clear settings reference
        this.settings = null;
        
        console.log('Insertive plugin unloaded');
    }
}

// Export the plugin class
module.exports = InsertivePlugin;