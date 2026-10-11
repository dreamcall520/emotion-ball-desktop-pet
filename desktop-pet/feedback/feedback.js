(async () => {
  const form = document.getElementById('feedback-form');
  const status = document.getElementById('status');
  const submit = document.getElementById('submit');
  const attachmentInput = document.getElementById('attachments');
  const list = document.getElementById('attachment-list');
  const bridge = window.qiuqiuFeedback;
  const endpoint = window.QIUQIU_FEEDBACK_CONFIG?.endpoint;
  let files = [], sending = false, retryKey = '', submissionId = '';
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  try {
    const theme = localStorage.getItem('emotion-ball-site-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {}
  if (bridge) {
    document.documentElement.dataset.context = 'app';
    document.getElementById('close').hidden = false;
    document.getElementById('close').onclick = () => bridge.close();
    bridge.onColorMode?.((_mode, appearance) => {
      if (appearance === 'light' || appearance === 'dark') document.documentElement.dataset.theme = appearance;
      else delete document.documentElement.dataset.theme;
    });
    try {
      const context = await bridge.getContext();
      for (const key of ['version', 'os']) { form.elements[key].value = context[key] || ''; form.elements[key].readOnly = true; }
    } catch { message('暂时无法读取使用环境，你仍可以填写反馈。', true); }
  }
  const configured = typeof endpoint === 'string' && /^https:\/\//.test(endpoint);
  submit.disabled = !configured;
  if (!configured) message('反馈通道暂未开放，请稍后再试。');
  const renderFiles = () => {
    list.replaceChildren();
    files.forEach((item, index) => {
      const row = document.createElement('li'), preview = document.createElement('img');
      preview.src = item.url; preview.alt = `截图 ${index + 1} 预览`;
      const name = document.createElement('span'); name.textContent = item.file.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除';
      remove.setAttribute('aria-label', `移除截图 ${index + 1}`);
      remove.disabled = sending;
      remove.onclick = () => { URL.revokeObjectURL(item.url); files.splice(index, 1); renderFiles(); attachmentInput.focus(); };
      row.append(preview, name, remove); list.append(row);
    });
  };
  attachmentInput.onchange = () => {
    message('');
    for (const file of attachmentInput.files) {
      if (files.length >= 3) { message('最多选择 3 张截图。', true); break; }
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { message('请选择 PNG、JPG、GIF 或 WebP 图片。', true); continue; }
      if (!file.size || file.size > 1024 * 1024) { message('每张截图需大于 0 字节且不超过 1 MB。', true); continue; }
      files.push({ file, url: URL.createObjectURL(file) });
    }
    attachmentInput.value = ''; renderFiles();
  };
  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] });
    reader.onerror = () => reject(new Error('截图读取失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (sending || !configured || !form.reportValidity()) return;
    if (!form.elements.title.value.trim() || !form.elements.detail.value.trim()) { message('请填写标题和详细说明。', true); return; }
    sending = true; message('正在提交，请稍候…');
    Array.from(form.elements).forEach(control => { control.disabled = true; }); renderFiles();
    try {
      const payload = { type: form.elements.type.value, title: form.elements.title.value.trim(), detail: form.elements.detail.value.trim(), contact: form.elements.contact.value.trim(), version: form.elements.version.value.trim(), os: form.elements.os.value.trim(), source: bridge ? 'app' : 'website', attachments: await Promise.all(files.map(item => readFile(item.file))) };
      const key = JSON.stringify(payload);
      if (key !== retryKey) { submissionId = crypto.randomUUID(); retryKey = key; }
      payload.submissionId = submissionId;
      let result;
      if (bridge) result = await bridge.submit(payload);
      else {
        const response = await fetch(endpoint, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(response.status === 429 ? '提交较频繁，请稍后重试。' : '提交失败，内容已保留，请稍后重试。');
        result = await response.json();
      }
      if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(result?.id || '')) throw new Error('未收到提交确认，内容已保留，请稍后重试。');
      form.hidden = true; message('');
      document.getElementById('receipt').textContent = `反馈编号：${result.id}`;
      document.getElementById('success').hidden = false; document.getElementById('success').focus();
    } catch (error) {
      message(bridge || error.message?.includes('截图') || error.message?.includes('提交') || error.message?.includes('确认') ? error.message : '网络暂时不可用，内容已保留，请稍后重试。', true);
      status.focus();
    } finally { sending = false; Array.from(form.elements).forEach(control => { control.disabled = false; }); renderFiles(); }
  };
  document.getElementById('again').onclick = () => {
    const version = form.elements.version.value, os = form.elements.os.value;
    form.reset();
    if (bridge) { form.elements.version.value = version; form.elements.os.value = os; }
    files.forEach(item => URL.revokeObjectURL(item.url)); files = []; renderFiles();
    retryKey = ''; submissionId = ''; form.hidden = false; document.getElementById('success').hidden = true; form.elements.title.focus();
  };
  window.addEventListener('beforeunload', (event) => {
    if (!form.hidden && (sending || form.elements.title.value || form.elements.detail.value || form.elements.contact.value || files.length)) { event.preventDefault(); event.returnValue = ''; }
  });
})();
