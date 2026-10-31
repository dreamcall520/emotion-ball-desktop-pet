(() => {
  let autoError = '';
  let root, api, state, sending = false, changing = false, retryKey = '', submissionId = '';
  let files = [];
  const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const find = id => root.querySelector(`#${id}`);
  function message(text) { find('report-status').textContent = text; }
  function renderFiles() {
    find('report-files').replaceChildren(...files.map((item, index) => {
      const row = node('li'), image = node('img'), label = node('span', item.file.name), remove = node('button', '移除', 'action');
      image.src = item.url; image.alt = `截图 ${index + 1}`; remove.type = 'button'; remove.disabled = sending;
      remove.setAttribute('aria-label', `移除截图 ${index + 1}`);
      remove.onclick = () => { URL.revokeObjectURL(item.url); files.splice(index, 1); renderFiles(); };
      row.append(image, label, remove); return row;
    }));
  }
  function updateState() {
    const toggle = find('report-auto');
    toggle.setAttribute('aria-checked', String(state?.enabled === true)); toggle.disabled = changing;
    find('report-auto-status').textContent = autoError || (!state?.enabled ? state?.lastError || ''
      : state.lastError ? `${state.lastError} · 待补报 ${state.pending || 0} 条`
      : state.pending ? `${state.pending} 条待补报`
      : state.lastSentAt ? `最近上报：${new Date(state.lastSentAt).toLocaleString('zh-CN')}` : '');
    find('report-diagnostic-preview').textContent = JSON.stringify(state?.context?.diagnostic || {}, null, 2);
  }
  function create() {
    root = node('div', '', 'feedback-settings');
    root.innerHTML = `
      <section class="group"><h3>反馈内容</h3>
        <form id="report-form">
          <fieldset id="report-fields">
            <div class="report-field"><span class="report-label" id="report-type-label">类型</span><div class="segmented report-types" id="report-type" role="radiogroup" aria-labelledby="report-type-label">
              <label><input type="radio" name="type" value="problem" checked><span>问题反馈</span></label><label><input type="radio" name="type" value="suggestion"><span>使用建议</span></label><label><input type="radio" name="type" value="feature"><span>功能需求</span></label>
            </div></div>
            <label class="report-field"><span class="report-label">标题</span><input name="title" id="report-title" maxlength="100" required placeholder="一句话描述问题或建议"></label>
            <label class="report-field"><span class="report-label">说明</span><textarea name="detail" id="report-detail" rows="4" maxlength="4000" required placeholder="补充操作步骤或具体想法"></textarea></label>
            <div class="report-field"><span class="report-label">截图</span><div id="report-dropzone" class="report-dropzone" tabindex="0" aria-label="截图，可拖拽或粘贴图片"><div class="report-upload"><button id="report-choose" class="action" type="button">添加截图</button><span class="description">拖拽或粘贴 · 最多 3 张，每张 1 MB</span><input id="report-attachments" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label="添加截图"></div><ul id="report-files" aria-label="已选截图"></ul></div></div>
            <label class="report-field"><span class="report-label">联系方式</span><input name="contact" id="report-contact" maxlength="200" autocomplete="off" placeholder="选填"></label>
            <div class="report-actions"><label class="report-diagnostics"><input id="report-diagnostics" type="checkbox" checked>附带运行环境</label><button id="report-submit" class="action report-submit" type="submit">提交反馈</button></div>
            <details class="report-preview"><summary>查看运行环境</summary><pre id="report-diagnostic-preview"></pre></details>
          </fieldset>
        </form>
        <p id="report-status" class="description" role="status" aria-live="polite" tabindex="-1"></p>
        <section id="report-success" hidden tabindex="-1"><h2>提交成功</h2><p id="report-receipt" class="description"></p><button id="report-again" class="action" type="button">再写一条</button></section>
      </section>
      <section class="group"><h3>异常上报</h3>
        <div class="row"><div><div class="row-title" id="report-auto-label">自动上报</div><p class="description" id="report-auto-description">开启后发送错误类型、时间和运行环境，不含聊天、便签和原始日志。</p></div><button type="button" id="report-auto" class="toggle" role="switch" aria-labelledby="report-auto-label" aria-describedby="report-auto-description" aria-checked="false"></button></div>
        <p id="report-auto-status" class="description" role="status"></p>
      </section>`;
    find('report-auto').onclick = async () => {
      if (changing) return;
      changing = true; autoError = ''; updateState();
      try {
        const result = await api.setAutoReport(state?.enabled !== true);
        if (!result?.ok) throw Error('保存未完成');
        state = result.state;
      } catch { autoError = '设置未保存，请稍后重试。'; }
      finally { changing = false; updateState(); }
    };
    find('report-choose').onclick = () => find('report-attachments').click();
    function addFiles(incoming) {
      if (sending || find('report-form').hidden) return;
      message('');
      for (const file of incoming) {
        if (files.length >= 3) { message('最多选择 3 张截图。'); break; }
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || !file.size || file.size > 1024 * 1024) {
          message('请选择 PNG、JPG、GIF 或 WebP 图片，每张不超过 1 MB。'); continue;
        }
        files.push({ file, url: URL.createObjectURL(file) });
      }
      renderFiles();
    }
    find('report-attachments').onchange = event => {
      addFiles(event.target.files); event.target.value = '';
    };
    const dropzone = find('report-dropzone');
    root.addEventListener('dragover', event => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    root.addEventListener('drop', event => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    dropzone.ondragover = event => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.dataTransfer.dropEffect = sending ? 'none' : 'copy';
      if (!sending) dropzone.classList.add('is-dragging');
    };
    dropzone.ondragleave = event => {
      if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('is-dragging');
    };
    dropzone.ondrop = event => {
      event.preventDefault(); dropzone.classList.remove('is-dragging');
      addFiles(event.dataTransfer?.files || []);
    };
    root.addEventListener('paste', event => {
      if (sending || find('report-form').hidden) return;
      const images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
      if (!images.length) return;
      event.preventDefault(); addFiles(images);
    });
    const readFile = file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] });
      reader.onerror = () => reject(Error('截图读取失败，请重新选择。'));
      reader.readAsDataURL(file);
    });
    find('report-form').onsubmit = async event => {
      event.preventDefault();
      if (sending || !find('report-form').reportValidity()) return;
      if (!find('report-title').value.trim() || !find('report-detail').value.trim()) { message('请填写标题和详细说明。'); return; }
      sending = true; find('report-fields').disabled = true; renderFiles(); message('正在提交，请稍候…');
      try {
        const payload = { type: find('report-form').elements.type.value, title: find('report-title').value.trim(), detail: find('report-detail').value.trim(),
          contact: find('report-contact').value.trim(), includeDiagnostics: find('report-diagnostics').checked,
          attachments: await Promise.all(files.map(item => readFile(item.file))) };
        const key = JSON.stringify(payload);
        if (retryKey !== key) { retryKey = key; submissionId = crypto.randomUUID(); }
        const result = await api.submitFeedback({ ...payload, submissionId });
        if (result?.error) throw Error(result.error);
        if (result?.id !== submissionId) throw Error('未收到提交确认，内容已保留，请稍后重试。');
        find('report-form').hidden = true; message(''); find('report-receipt').textContent = `反馈编号：${result.id}`;
        find('report-success').hidden = false; find('report-success').focus();
      } catch (error) { message(error.message || '提交未完成，内容已保留，请稍后重试。'); find('report-status').focus(); }
      finally { sending = false; find('report-fields').disabled = false; renderFiles(); }
    };
    find('report-again').onclick = () => {
      find('report-form').reset(); files.forEach(item => URL.revokeObjectURL(item.url)); files = []; renderFiles();
      retryKey = ''; submissionId = ''; find('report-form').hidden = false; find('report-success').hidden = true; message(''); find('report-title').focus();
    };
    window.addEventListener('beforeunload', event => {
      if (!find('report-form').hidden && (sending || files.length || find('report-title').value || find('report-detail').value || find('report-contact').value)) {
        event.preventDefault(); event.returnValue = '';
      }
    });
  }
  window.renderSettingsFeedback = (host, value, bridge) => {
    api = bridge; state = value;
    if (!root) create();
    // Keep the same form node so settings refreshes and tab changes preserve the draft.
    if (host.firstChild !== root) host.replaceChildren(root);
    updateState();
  };
})();
