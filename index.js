import { extension_settings, getContext } from '../../../extensions.js';

const MODULE = 'st_edita_texto';
const PANEL = 'st-edita-texto-settings';
let selected = null;
let captureTimer;

function settings() {
    extension_settings[MODULE] ??= { enabled: true };
    return extension_settings[MODULE];
}
function status(text, error = false) {
    const el = document.getElementById('ste-status');
    if (el) { el.textContent = text; el.classList.toggle('ste-error', error); }
}
function capture() {
    if (!settings().enabled) return;
    const active = document.activeElement;
    if (active?.id === 'ste-text') return;
    const isTextField = active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password'].includes(active.type));
    if (isTextField) {
        const { selectionStart: start, selectionEnd: end } = active;
        if (typeof start === 'number' && end > start) {
            const text = active.value.slice(start, end);
            selected = { kind: 'field', target: active, start, end, original: text };
            const editor = document.getElementById('ste-text');
            if (editor) editor.value = text;
            status('Texto selecionado. Escolha uma ação.');
            return;
        }
    }
    const sel = window.getSelection?.();
    if (!sel?.rangeCount || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const a = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const b = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    const body = a?.closest?.('.mes_text');
    if (!body || body !== b?.closest?.('.mes_text')) return;
    const element = body.closest('.mes');
    const index = Number(element?.getAttribute('mesid'));
    if (!Number.isInteger(index) || index < 0) return;
    selected = { kind: 'message', index, original: sel.toString() };
    const editor = document.getElementById('ste-text');
    if (editor) editor.value = selected.original;
    status('Texto selecionado. Escolha uma ação.');
}
function queueCapture() {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(capture, 100);
}
function apply(text) {
    const ctx = getContext();
    if (!settings().enabled) throw new Error('Ative a extensão para usar os botões.');
    if (!selected) throw new Error('Selecione um trecho primeiro.');
    if (selected.kind === 'field') {
        const { target, start, end, original } = selected;
        if (!target.isConnected || target.value.slice(start, end) !== original) throw new Error('O campo mudou. Selecione o texto novamente.');
        target.setRangeText(text, start, end, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        const msg = ctx.chat?.[selected.index];
        if (!msg || typeof msg.mes !== 'string') throw new Error('Não encontrei a mensagem no chat.');
        const at = msg.mes.indexOf(selected.original);
        if (at < 0 || msg.mes.indexOf(selected.original, at + 1) >= 0) throw new Error('Não localizei o trecho de forma única. Tente selecionar um trecho sem formatação.');
        msg.mes = msg.mes.slice(0, at) + text + msg.mes.slice(at + selected.original.length);
        if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
        if (typeof ctx.updateMessageBlock !== 'function') throw new Error('Esta versão do SillyTavern não permite atualizar a mensagem.');
        ctx.updateMessageBlock(selected.index, msg);
        ctx.saveChatConditional?.();
    }
    selected = null;
}

async function suggestWithAI() {
    const editor = document.getElementById('ste-text');
    const text = editor?.value ?? '';
    if (!text.trim()) return status('Selecione um texto primeiro.', true);
    const generate = getContext().generateQuietPrompt;
    if (typeof generate !== 'function') return status('Não encontrei o modelo ativo do SillyTavern.', true);
    const button = document.getElementById('ste-ai');
    button.disabled = true;
    status('Pedindo uma sugestão ao modelo…');
    try {
        const result = await generate({ quietPrompt: `Reescreva o texto abaixo preservando o sentido, a voz e o tom. Responda somente com o texto reescrito.\n\n${text}` });
        if (!String(result ?? '').trim()) throw new Error('O modelo não retornou uma sugestão.');
        editor.value = String(result).trim();
        status('Sugestão pronta. Confira e clique em “Aplicar edição” quando quiser.');
    } catch (error) {
        status(`Não consegui gerar a sugestão: ${error.message || error}`, true);
    } finally {
        button.disabled = false;
    }
}

function mountPanel() {
    if (document.getElementById(PANEL)) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const panel = document.createElement('section');
    panel.id = PANEL;
    panel.className = 'inline-drawer';
    panel.innerHTML = `
      <div class="inline-drawer-toggle inline-drawer-header"><b>📝 Editar texto selecionado</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
      <div class="inline-drawer-content ste-content">
        <label class="checkbox_label" for="ste-enabled"><input id="ste-enabled" type="checkbox"><span>Ativar extensão</span></label>
        <p>Selecione um trecho no chat ou numa caixa de texto. Depois escolha uma ação:</p>
        <label for="ste-text">Texto selecionado (você pode editar aqui)</label>
        <textarea id="ste-text" class="text_pole" rows="5" placeholder="Selecione um texto para começar…"></textarea>
        <div class="ste-buttons">
          <button id="ste-apply" class="menu_button">Aplicar edição</button>
          <button id="ste-ai" class="menu_button">Sugerir com IA</button>
          <button id="ste-delete" class="menu_button">Apagar seleção</button>
        </div>
        <div id="ste-status" class="ste-status" role="status" aria-live="polite">Selecione um trecho no chat para começar.</div>
      </div>`;
    host.append(panel);
    const enabled = panel.querySelector('#ste-enabled');
    enabled.checked = settings().enabled;
    enabled.addEventListener('change', () => {
        settings().enabled = enabled.checked;
        getContext().saveSettingsDebounced();
        status(enabled.checked ? 'Extensão ativada. Selecione um trecho.' : 'Extensão desativada.');
    });
    panel.querySelector('#ste-apply').addEventListener('click', () => {
        try {
            const text = panel.querySelector('#ste-text').value;
            if (!text.trim()) return status('O texto está vazio. Use “Apagar seleção” para removê-lo.', true);
            apply(text);
            status('Edição aplicada.');
        } catch (error) { status(error.message || String(error), true); }
    });
    panel.querySelector('#ste-delete').addEventListener('click', () => {
        try {
            apply('');
            panel.querySelector('#ste-text').value = '';
            status('Trecho apagado.');
        } catch (error) { status(error.message || String(error), true); }
    });
    panel.querySelector('#ste-ai').addEventListener('click', suggestWithAI);

}

function init() {
    settings();
    mountPanel();
    document.addEventListener('selectionchange', queueCapture);
    document.addEventListener('mouseup', queueCapture);
    document.addEventListener('keyup', queueCapture);
    document.addEventListener('touchend', queueCapture, { passive: true });
    console.info('[Editar texto selecionado] Extensão carregada.');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
