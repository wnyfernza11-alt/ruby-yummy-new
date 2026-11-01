/* ============ RUBY YUMMY - ระบบสะสมแต้ม (Supabase Cloud) ============ */
(function () {
  'use strict';

 /* ---------- การเชื่อมต่อ Supabase ---------- */
const SUPABASE_URL = "https://uqomgswtaucspqlgriqq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_A4uycPLpl4zgCzaDeNlhHQ_MS8qCDBx";
  const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  const SESSION_KEY = 'ruby_yummy_session_v3';
  const ADMIN_HASH = '495c756ae68ae048629e8658876aabbbb6b65e1320611b0f3e445fac8200bfd9'; // รหัสแอดมิน MINT1101 (เก็บเป็นแฮช)
  const POINTS_PER_SLIP = 1;       // 1 สลิป = 1 แต้ม
  const LIST_LIMIT = 50;           // จำนวนรายการล่าสุดที่โหลดต่อครั้ง
  const POLL_MS = 20000;           // ดึงข้อมูลใหม่อัตโนมัติทุก 20 วินาที

  const REWARDS = [
    { emoji: '🍱🍌', name: 'ข้าวยำเกาหลี 1 กล่อง + นมกล้วย 1 กล่อง', desc: 'สะสมแต้มหัวใจครบ 10 แต้ม รับฟรีทันที!', cost: 10 }
  ];

  /* ---------- สถานะในหน้าเว็บ ---------- */
  let me = null;                   // ลูกค้าที่ล็อกอินอยู่ {id, name, points}
  let mySlips = [];
  let myReds = [];
  let adminData = { pending: [], done: [], reds: [], counts: { pending: 0, approved: 0, rejected: 0 }, imgCount: 0 };
  const names = {};                // user_id -> ชื่อ (ใช้ฝั่งแอดมิน)
  const imgCache = {};             // slip id -> data URL
  let pendingImage = '';
  let adminFails = 0;
  let adminLockUntil = 0;
  let refreshing = false;

  /* ---------- แฮชรหัสผ่าน SHA-256 (ทำงานได้ทั้ง http/https) ---------- */
  function sha256(msg) {
    const rr = (v, a) => (v >>> a) | (v << (32 - a));
    const pow = Math.pow, mw = pow(2, 32);
    const H = [], K = [], primes = [];
    for (let c = 2; primes.length < 64; c++) {
      let isPrime = true;
      for (let i = 0; i < primes.length; i++) if (c % primes[i] === 0) { isPrime = false; break; }
      if (isPrime) primes.push(c);
    }
    for (let i = 0; i < 64; i++) {
      if (i < 8) H[i] = (pow(primes[i], 0.5) * mw) | 0;
      K[i] = (pow(primes[i], 1 / 3) * mw) | 0;
    }
    const bytes = new TextEncoder().encode(msg);
    const bitLen = bytes.length * 8;
    const n = ((bytes.length + 9 + 63) >> 6) << 4;
    const w32 = new Array(n).fill(0);
    for (let i = 0; i < bytes.length; i++) w32[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    w32[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
    w32[n - 2] = Math.floor(bitLen / mw);
    w32[n - 1] = bitLen | 0;
    for (let j = 0; j < n; j += 16) {
      const w = w32.slice(j, j + 16);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
  }
  const hashPw = p => sha256('ruby-yummy:' + p);

  /* ---------- ตัวช่วย ---------- */
  const $ = id => document.getElementById(id);
  const fmtMoney = n => Number(n).toLocaleString('th-TH') + ' บาท';
  const fmtTime = ts => new Date(ts).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) + ' น.';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();

  function statusBadge(status) {
    if (status === 'pending') return '<span class="badge badge-pending">⏳ รอตรวจสอบ 🐻</span>';
    if (status === 'approved') return '<span class="badge badge-approved">✅ อนุมัติแล้ว/ได้รับแต้มแล้ว 🐱</span>';
    return '<span class="badge badge-rejected">❌ ไม่ผ่านการอนุมัติ</span>';
  }

  function emptyState(emoji, text) {
    return '<div class="empty"><div class="empty-emoji">' + emoji + '</div><p>' + text + '</p></div>';
  }

  function thumbHtml(s) {
    if (!s.has_image) return '<div class="slip-thumb" data-noimg="1">🧾</div>';
    const src = imgCache[s.id];
    return '<div class="slip-thumb" data-img="' + esc(s.id) + '">' + (src ? '<img src="' + src + '" alt="สลิป">' : '🧾') + '</div>';
  }

  /* ---------- เซสชัน ---------- */
  function getSession() {
    try {
      const a = sessionStorage.getItem(SESSION_KEY);
      if (a) { const s = JSON.parse(a); if (s && s.role === 'admin') return s; }
      const c = localStorage.getItem(SESSION_KEY);
      if (c) { const s2 = JSON.parse(c); if (s2 && s2.role === 'customer' && s2.uid) return s2; }
    } catch (e) { /* ไม่มีเซสชัน */ }
    return null;
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }
  function setSession(s) {
    clearSession();
    try {
      if (s.role === 'admin') sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }
  const isAdmin = () => { const s = getSession(); return !!(s && s.role === 'admin'); };
  const currentUser = () => { const s = getSession(); return (s && s.role === 'customer' && me && me.id === s.uid) ? me : null; };

  /* ---------- โมดัล & Toast ---------- */
  let modalCallback = null;

  function showModal(opts) {
    $('modalIcon').textContent = opts.icon || '🐻';
    $('modalTitle').textContent = opts.title || 'แจ้งเตือน';
    $('modalMsg').textContent = opts.message || '';
    $('modalOk').textContent = opts.okText || 'ตกลง';
    $('modalCancel').hidden = !opts.confirm;
    modalCallback = opts.onOk || null;
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; modalCallback = null; }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2500);
  }

  function dbError(err, msg) {
    console.error(err);
    showModal({
      icon: '🐻', title: 'เชื่อมต่อฐานข้อมูลไม่ได้',
      message: (msg || 'ทำรายการไม่สำเร็จ') + '\nกรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้งนะ'
    });
  }

  // ป้องกันกดปุ่มซ้ำระหว่างรอฐานข้อมูล
  async function withBusy(form, fn) {
    const btn = form.querySelector('button[type=submit]');
    if (btn && btn.disabled) return;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังดำเนินการ… ⏳'; }
    try { await fn(); }
    catch (err) { dbError(err); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  /* ---------- ติดต่อฐานข้อมูล ---------- */
  async function addPoints(uid, n) {
    for (let i = 0; i < 5; i++) {
      const r = await supabase.from('users').select('points').eq('id', uid).maybeSingle();
      if (r.error || !r.data) return false;
      const upd = await supabase.from('users').update({ points: r.data.points + n })
        .eq('id', uid).eq('points', r.data.points).select('id');
      if (upd.error) return false;
      if (upd.data && upd.data.length) return true;
    }
    return false;
  }

  async function loadCustomer() {
    if (!me) return;
    const [u, sl, rd] = await Promise.all([
      supabase.from('users').select('id,name,points').eq('id', me.id).maybeSingle(),
      supabase.from('slips').select('id,user_id,amount,status,points,has_image,image_deleted,created_at,reviewed_at')
        .eq('user_id', me.id).order('created_at', { ascending: false }).limit(LIST_LIMIT),
      supabase.from('redemptions').select('id,reward,code,points,created_at')
        .eq('user_id', me.id).order('created_at', { ascending: false }).limit(LIST_LIMIT)
    ]);
    if (u.error || sl.error || rd.error) throw (u.error || sl.error || rd.error);
    if (!u.data) { // บัญชีถูกลบออกจากฐานข้อมูล
      clearSession(); me = null; route();
      showModal({ icon: '🐻', title: 'ไม่พบบัญชี', message: 'ไม่พบบัญชีนี้ในระบบแล้ว กรุณาสมัครสมาชิกใหม่นะ' });
      return;
    }
    me = u.data;
    mySlips = sl.data || [];
    myReds = rd.data || [];
  }

  async function loadAdmin() {
    const cols = 'id,user_id,amount,status,points,has_image,image_deleted,created_at,reviewed_at';
    const cnt = st => supabase.from('slips').select('id', { count: 'exact', head: true }).eq('status', st);
    const [p, d, rd, cP, cA, cR, cI] = await Promise.all([
      supabase.from('slips').select(cols).eq('status', 'pending').order('created_at', { ascending: true }),
      supabase.from('slips').select(cols).neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(LIST_LIMIT),
      supabase.from('redemptions').select('id,user_id,reward,code,points,created_at').order('created_at', { ascending: false }).limit(LIST_LIMIT),
      cnt('pending'), cnt('approved'), cnt('rejected'),
      supabase.from('slips').select('id', { count: 'exact', head: true }).neq('status', 'pending').eq('has_image', true)
    ]);
    const bad = [p, d, rd, cP, cA, cR, cI].find(x => x.error);
    if (bad) throw bad.error;
    adminData = {
      pending: p.data || [], done: d.data || [], reds: rd.data || [],
      counts: { pending: cP.count || 0, approved: cA.count || 0, rejected: cR.count || 0 },
      imgCount: cI.count || 0
    };
    // ดึงชื่อลูกค้าที่เกี่ยวข้อง
    const ids = [];
    adminData.pending.concat(adminData.done, adminData.reds).forEach(x => {
      if (!names[x.user_id] && ids.indexOf(x.user_id) < 0) ids.push(x.user_id);
    });
    if (ids.length) {
      const nm = await supabase.from('users').select('id,name').in('id', ids);
      if (nm.error) throw nm.error;
      (nm.data || []).forEach(u => { names[u.id] = u.name; });
    }
  }

  // โหลดรูปสลิปแบบทยอยโหลด (ไม่ดึงรูปทั้งหมดพร้อมกัน เพื่อให้หน้าเว็บเร็ว)
  async function loadThumbs() {
    const list = isAdmin() ? adminData.pending.concat(adminData.done) : mySlips;
    const need = list.filter(s => s.has_image && !imgCache[s.id]).map(s => s.id);
    for (let i = 0; i < need.length; i += 6) {
      const chunk = need.slice(i, i + 6);
      const r = await supabase.from('slips').select('id,image').in('id', chunk);
      if (r.error) return;
      (r.data || []).forEach(row => {
        if (!row.image) return;
        imgCache[row.id] = row.image;
        document.querySelectorAll('.slip-thumb[data-img="' + row.id + '"]').forEach(el => {
          el.innerHTML = '<img src="' + row.image + '" alt="สลิป">';
        });
      });
    }
  }

  async function refresh(silent) {
    if (refreshing || !supabase) return;
    if (!isAdmin() && !currentUser()) return;
    refreshing = true;
    try {
      if (isAdmin()) await loadAdmin(); else await loadCustomer();
      renderAll();
      loadThumbs();
    } catch (err) {
      if (!silent) dbError(err, 'โหลดข้อมูลไม่สำเร็จ');
      else console.error(err);
    } finally {
      refreshing = false;
    }
  }

  /* ---------- เนื้อหาหน้าแอดมิน (สร้างหลังล็อกอินเท่านั้น) ---------- */
  function adminTemplate() {
    return '' +
      '<div class="admin-banner">' +
        '<img class="admin-logo" src="logo.png" alt="โลโก้ร้าน RUBY YUMMY">' +
        '<div><h2>แผงตรวจสอบสลิป (แอดมิน)</h2><p>ตรวจสอบสลิปจากลูกค้าและอนุมัติแต้มหัวใจ</p></div>' +
      '</div>' +
      '<div class="stats">' +
        '<div class="stat"><b id="statPending">0</b><span>รอตรวจสอบ ⏳</span></div>' +
        '<div class="stat"><b id="statApproved">0</b><span>อนุมัติแล้ว ✅</span></div>' +
        '<div class="stat"><b id="statRejected">0</b><span>ไม่ผ่าน ❌</span></div>' +
      '</div>' +
      '<div class="section-title">⏳ สลิปที่รอตรวจสอบ</div>' +
      '<div id="adminPending" class="slip-list"></div>' +
      '<div class="section-title">🎁 ประวัติการแลกรางวัลของลูกค้า</div>' +
      '<div id="adminRedeems" class="slip-list"></div>' +
      '<div class="section-title">🗂️ สลิปที่ตรวจสอบแล้ว</div>' +
      '<div id="adminBulk"></div>' +
      '<div id="adminDone" class="slip-list"></div>';
  }

  /* ---------- วาดหน้าฝั่งลูกค้า ---------- */
  function renderCustomer() {
    const u = currentUser();
    if (!u) return;
    const reward = REWARDS[0];

    $('cardName').textContent = u.name;
    $('cardPoints').textContent = u.points;

    const filled = Math.min(u.points, 10);
    let hearts = '';
    for (let i = 0; i < 10; i++) hearts += '<div class="heart-slot' + (i < filled ? ' filled' : '') + '">💕</div>';
    $('heartsRow').innerHTML = hearts;

    $('cardNext').textContent = u.points >= reward.cost
      ? 'แต้มครบแล้ว! กดแลกรางวัลด้านล่างได้เลย 🎉'
      : 'อีก ' + (reward.cost - u.points) + ' แต้ม แลกรางวัลได้เลย! 🐻';

    $('rewardList').innerHTML = REWARDS.map((rw, idx) => {
      const ready = u.points >= rw.cost;
      const extra = ready
        ? '<div class="redeem-box">' +
            '<p class="redeem-note">📸 <b>ก่อนกดแลกรางวัล</b> กรุณาแคปภาพหน้าจอ เพื่อนำไปแลกรางวัลในโอเพ่นแชทกลุ่ม<br>⚠️ เมื่อกดแล้ว แต้มสะสมทั้งหมดจะรีเซ็ตเป็น 0</p>' +
            '<button type="button" class="btn btn-redeem" data-act="redeem" data-idx="' + idx + '">🎁 กดแลกรางวัล</button>' +
          '</div>'
        : '<div class="redeem-box locked"><p class="redeem-note">🔒 สะสมอีก <b>' + (rw.cost - u.points) + '</b> แต้ม จึงจะแลกรางวัลได้</p></div>';
      return '<div class="reward-block">' +
        '<div class="reward' + (ready ? ' ready' : '') + '">' +
          '<div class="reward-emoji">' + rw.emoji + '</div>' +
          '<div class="reward-info"><b>' + rw.name + '</b><small>' + rw.desc + '</small></div>' +
          '<div class="reward-cost">' + rw.cost + ' 💕</div>' +
        '</div>' + extra + '</div>';
    }).join('');

    $('slipHistory').innerHTML = mySlips.length ? mySlips.map(s => {
      const pts = s.status === 'approved'
        ? '<div class="slip-points">ได้รับ +' + s.points + ' แต้ม 💕</div>'
        : (s.status === 'pending' ? '<div class="slip-points">จะได้รับ ' + POINTS_PER_SLIP + ' แต้ม (หากอนุมัติ)</div>' : '');
      return '<div class="slip">' + thumbHtml(s) +
        '<div class="slip-body">' + statusBadge(s.status) +
        '<div class="slip-amount">' + fmtMoney(s.amount) + '</div>' + pts +
        '<div class="slip-time">ส่งเมื่อ ' + fmtTime(s.created_at) + '</div></div></div>';
    }).join('') : emptyState('🐻', 'ยังไม่มีการส่งสลิปเลย<br>ไปแจ้งโอนสลิปแรกกันนะ 💕');

    $('redeemHistory').innerHTML = myReds.length ? myReds.map(r =>
      '<div class="slip"><div class="slip-thumb" style="cursor:default">🎁</div>' +
        '<div class="slip-body"><span class="badge badge-approved">🎉 แลกรางวัลแล้ว</span>' +
        '<div class="slip-amount" style="font-size:1rem">' + esc(r.reward) + '</div>' +
        '<div class="slip-points">รหัส: ' + esc(r.code) + '</div>' +
        '<div class="slip-time">เมื่อ ' + fmtTime(r.created_at) + '</div></div></div>'
    ).join('') : emptyState('🐱', 'ยังไม่เคยแลกรางวัล<br>สะสมให้ครบ 10 แต้มนะ 💕');

    const pending = mySlips.filter(s => s.status === 'pending').length;
    $('navBadge').textContent = pending;
    $('navBadge').hidden = pending === 0;

    if (document.activeElement !== $('profName')) $('profName').value = u.name;
    $('headerUserName').textContent = '🐱 ' + u.name;
  }

  /* ---------- วาดหน้าแอดมิน ---------- */
  function renderAdmin() {
    if (!isAdmin() || !$('adminPending')) return;
    const a = adminData;
    const who = id => esc(names[id] || 'ไม่พบผู้ใช้');

    $('statPending').textContent = a.counts.pending;
    $('statApproved').textContent = a.counts.approved;
    $('statRejected').textContent = a.counts.rejected;

    $('adminPending').innerHTML = a.pending.length ? a.pending.map(s =>
      '<div class="slip">' + thumbHtml(s) +
        '<div class="slip-body">' + statusBadge(s.status) +
        '<div class="slip-amount">' + fmtMoney(s.amount) + '</div>' +
        '<div class="slip-user">👤 ' + who(s.user_id) + '</div>' +
        '<div class="slip-points">จะได้ ' + POINTS_PER_SLIP + ' แต้ม 💕</div>' +
        '<div class="slip-time">ส่งเมื่อ ' + fmtTime(s.created_at) + '</div>' +
        '<div class="slip-actions">' +
        '<button class="btn btn-ok" data-act="approve" data-id="' + esc(s.id) + '">✅ อนุมัติ</button>' +
        '<button class="btn btn-no" data-act="reject" data-id="' + esc(s.id) + '">❌ ปฏิเสธ</button>' +
        '</div></div></div>'
    ).join('') : emptyState('🐱', 'ไม่มีสลิปรอตรวจสอบ<br>เยี่ยมมาก! งานเสร็จหมดแล้ว 💕');

    $('adminRedeems').innerHTML = a.reds.length ? a.reds.map(r =>
      '<div class="slip"><div class="slip-thumb" style="cursor:default">🎁</div>' +
        '<div class="slip-body"><span class="badge badge-approved">🎉 แลกรางวัล</span>' +
        '<div class="slip-user">👤 ' + who(r.user_id) + '</div>' +
        '<div class="slip-amount" style="font-size:1rem">' + esc(r.reward) + '</div>' +
        '<div class="slip-points">รหัส: ' + esc(r.code) + '</div>' +
        '<div class="slip-time">เมื่อ ' + fmtTime(r.created_at) + '</div></div></div>'
    ).join('') : emptyState('🐻', 'ยังไม่มีลูกค้าแลกรางวัล');

    $('adminDone').innerHTML = a.done.length ? a.done.map(s =>
      '<div class="slip">' + thumbHtml(s) +
        '<div class="slip-body">' + statusBadge(s.status) +
        '<div class="slip-amount">' + fmtMoney(s.amount) + '</div>' +
        '<div class="slip-user">👤 ' + who(s.user_id) + '</div>' +
        (s.status === 'approved' ? '<div class="slip-points">มอบแต้ม +' + s.points + ' 💕</div>' : '') +
        '<div class="slip-time">ตรวจเมื่อ ' + fmtTime(s.reviewed_at) + '</div>' +
        (s.has_image
          ? '<div class="slip-actions"><button class="btn btn-no" type="button" data-act="delimg" data-id="' + esc(s.id) + '">🗑️ ลบรูปสลิป</button></div>'
          : (s.image_deleted ? '<div class="slip-time">🗑️ ลบรูปสลิปแล้ว</div>' : '')) +
        '</div></div>'
    ).join('') : emptyState('🐻', 'ยังไม่มีประวัติการตรวจสอบ');

    $('adminBulk').innerHTML = a.imgCount
      ? '<div class="bulk-bar"><button class="btn btn-no" type="button" data-act="delallimg">🗑️ ลบรูปสลิปที่ตรวจแล้วทั้งหมด (' + a.imgCount + ' รูป)</button></div>'
      : '';
  }

  function renderAll() {
    if (isAdmin()) renderAdmin();
    else if (currentUser()) renderCustomer();
  }

  /* ---------- เปลี่ยนหน้า (แยกลูกค้า/แอดมิน) ---------- */
  function showView(view) {
    $('authView').hidden = view !== 'auth';
    $('customerView').hidden = view !== 'customer';
    $('adminView').hidden = view !== 'admin';
    document.body.classList.toggle('in-auth', view === 'auth');
    document.body.classList.toggle('in-customer', view === 'customer');
    document.body.classList.toggle('in-admin', view === 'admin');

    $('headerUser').hidden = view === 'auth';
    if (view === 'customer') $('headerUserName').textContent = '🐱 ' + (me ? me.name : '');
    if (view === 'admin') $('headerUserName').textContent = '🐻 แอดมิน';

    // เนื้อหาแอดมินมีอยู่ในหน้าเว็บเฉพาะตอนล็อกอินแอดมินเท่านั้น
    if (view === 'admin') {
      if (!$('adminPending')) $('adminView').innerHTML = adminTemplate();
    } else {
      $('adminView').innerHTML = '';
    }
    renderAll();
  }

  function route() {
    const sess = getSession();
    let view = 'auth';
    if (sess && sess.role === 'admin') view = 'admin';
    else if (sess && sess.role === 'customer' && me && me.id === sess.uid) view = 'customer';
    const h = { auth: '#login', customer: '#customer', admin: '#admin' }[view];
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
    }
    showView(view);
  }

  function setTab(name) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setAuthTab(name) {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-auth') === name));
    $('loginForm').hidden = name !== 'login';
    $('registerForm').hidden = name !== 'register';
  }

  /* ---------- ย่อรูปสลิปก่อนบันทึก ---------- */
  function compressImage(file, cb) {
    const reader = new FileReader();
    reader.onerror = () => cb(null);
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => cb(null);
      img.onload = () => {
        const max = 800;
        let w = img.width, h = img.height;
        if (w > max || h > max) {
          const ratio = Math.min(max / w, max / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearPreview() {
    pendingImage = '';
    $('slipFile').value = '';
    $('slipPreview').hidden = true;
    $('slipPreview').removeAttribute('src');
    $('uploadPlaceholder').hidden = false;
    $('removePreview').hidden = true;
  }

  /* ---------- แอดมิน: อนุมัติ / ปฏิเสธ ---------- */
  function findAdminSlip(id) {
    return adminData.pending.concat(adminData.done).find(s => s.id === id) || null;
  }

  function approveSlip(id) {
    if (!isAdmin()) return;
    const s = findAdminSlip(id);
    if (!s || s.status !== 'pending') return;
    showModal({
      icon: '🐱', title: 'ยืนยันการอนุมัติ', confirm: true, okText: 'อนุมัติเลย',
      message: 'ยอดโอน ' + fmtMoney(s.amount) + '\nลูกค้า: ' + (names[s.user_id] || '-') + '\nจะได้รับ ' + POINTS_PER_SLIP + ' แต้มหัวใจ 💕',
      onOk: async () => {
        try {
          toast('กำลังบันทึก… ⏳');
          // อัปเดตเฉพาะสลิปที่ยัง pending เท่านั้น กันกดอนุมัติซ้ำ/อนุมัติพร้อมกัน
          const up = await supabase.from('slips')
            .update({ status: 'approved', points: POINTS_PER_SLIP, reviewed_at: new Date().toISOString() })
            .eq('id', s.id).eq('status', 'pending').select('id');
          if (up.error) throw up.error;
          if (!up.data || !up.data.length) {
            toast('สลิปนี้ถูกตรวจสอบไปแล้ว');
            await refresh(true);
            return;
          }
          const ok = await addPoints(s.user_id, POINTS_PER_SLIP);
          if (!ok) {
            await supabase.from('slips').update({ status: 'pending', points: 0, reviewed_at: null }).eq('id', s.id);
            throw new Error('เพิ่มแต้มไม่สำเร็จ');
          }
          await refresh(true);
          toast('✅ อนุมัติแล้ว เพิ่ม ' + POINTS_PER_SLIP + ' แต้มให้ลูกค้า 💕');
        } catch (err) { dbError(err, 'อนุมัติสลิปไม่สำเร็จ'); }
      }
    });
  }

  function rejectSlip(id) {
    if (!isAdmin()) return;
    const s = findAdminSlip(id);
    if (!s || s.status !== 'pending') return;
    showModal({
      icon: '🐻', title: 'ยืนยันการปฏิเสธ', confirm: true, okText: 'ปฏิเสธสลิป',
      message: 'ต้องการปฏิเสธสลิปยอด ' + fmtMoney(s.amount) + ' ใช่หรือไม่?',
      onOk: async () => {
        try {
          toast('กำลังบันทึก… ⏳');
          const up = await supabase.from('slips')
            .update({ status: 'rejected', points: 0, reviewed_at: new Date().toISOString() })
            .eq('id', s.id).eq('status', 'pending').select('id');
          if (up.error) throw up.error;
          await refresh(true);
          toast(up.data && up.data.length ? '❌ ปฏิเสธสลิปเรียบร้อยแล้ว' : 'สลิปนี้ถูกตรวจสอบไปแล้ว');
        } catch (err) { dbError(err, 'ปฏิเสธสลิปไม่สำเร็จ'); }
      }
    });
  }

  /* ---------- แอดมิน: ลบรูปสลิป (ลดขนาดข้อมูล) ---------- */
  function deleteSlipImage(id) {
    if (!isAdmin()) return;
    const s = findAdminSlip(id);
    if (!s || !s.has_image || s.status === 'pending') return;
    showModal({
      icon: '🗑️', title: 'ลบรูปสลิป', confirm: true, okText: 'ลบรูป',
      message: 'ลบรูปสลิปยอด ' + fmtMoney(s.amount) + ' ใช่หรือไม่?\nรายการและแต้มจะยังอยู่ แต่จะกู้รูปคืนไม่ได้',
      onOk: async () => {
        try {
          const r = await supabase.from('slips').update({ image: null, image_deleted: true })
            .eq('id', s.id).neq('status', 'pending').select('id');
          if (r.error) throw r.error;
          delete imgCache[s.id];
          await refresh(true);
          toast('🗑️ ลบรูปสลิปแล้ว');
        } catch (err) { dbError(err, 'ลบรูปไม่สำเร็จ'); }
      }
    });
  }

  function deleteAllDoneImages() {
    if (!isAdmin() || !adminData.imgCount) return;
    showModal({
      icon: '🗑️', title: 'ลบรูปสลิปทั้งหมด', confirm: true, okText: 'ลบทั้งหมด',
      message: 'ลบรูปสลิปที่ตรวจสอบแล้วทั้งหมด ' + adminData.imgCount + ' รูป ใช่หรือไม่?\nสลิปที่ยังรอตรวจสอบจะไม่ถูกลบ และกู้รูปคืนไม่ได้',
      onOk: async () => {
        try {
          const r = await supabase.from('slips').update({ image: null, image_deleted: true })
            .neq('status', 'pending').eq('has_image', true).select('id');
          if (r.error) throw r.error;
          Object.keys(imgCache).forEach(k => { delete imgCache[k]; });
          await refresh(true);
          toast('🗑️ ลบรูปสลิป ' + (r.data ? r.data.length : 0) + ' รูปแล้ว');
        } catch (err) { dbError(err, 'ลบรูปไม่สำเร็จ'); }
      }
    });
  }

  /* ---------- ลูกค้า: แลกรางวัล ---------- */
  function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'RY-' + out;
  }

  function redeemReward(idx) {
    const u = currentUser();
    const rw = REWARDS[idx];
    if (!u || !rw) return;
    if (u.points < rw.cost) {
      showModal({ icon: '🐱', title: 'แต้มยังไม่ครบ', message: 'ต้องสะสมให้ครบ ' + rw.cost + ' แต้มก่อนนะ' });
      return;
    }
    showModal({
      icon: '🎁', title: 'ยืนยันการแลกรางวัล', confirm: true, okText: 'ยืนยัน แลกเลย',
      message: rw.name + '\n\n📸 หลังกดยืนยัน กรุณาแคปภาพหน้าจอบัตรแลกรางวัล แล้วนำไปแลกรางวัลในโอเพ่นแชทกลุ่ม\n\n⚠️ แต้มสะสมทั้งหมดจะรีเซ็ตเป็น 0',
      onOk: async () => {
        try {
          toast('กำลังบันทึก… ⏳');
          // ตรวจแต้มล่าสุดจากฐานข้อมูล แล้วรีเซ็ตเฉพาะเมื่อแต้มยังไม่เปลี่ยน
          const cur = await supabase.from('users').select('points').eq('id', u.id).maybeSingle();
          if (cur.error) throw cur.error;
          if (!cur.data || cur.data.points < rw.cost) {
            await refresh(true);
            showModal({ icon: '🐱', title: 'แต้มยังไม่ครบ', message: 'แต้มสะสมของคุณยังไม่ครบ ' + rw.cost + ' แต้ม' });
            return;
          }
          const usedPoints = cur.data.points;
          const reset = await supabase.from('users').update({ points: 0 })
            .eq('id', u.id).eq('points', usedPoints).select('id');
          if (reset.error) throw reset.error;
          if (!reset.data || !reset.data.length) {
            await refresh(true);
            toast('แต้มมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง');
            return;
          }
          const code = makeCode();
          const ins = await supabase.from('redemptions')
            .insert({ user_id: u.id, reward: rw.name, code: code, points: usedPoints })
            .select('created_at').single();
          if (ins.error) {
            await supabase.from('users').update({ points: usedPoints }).eq('id', u.id).eq('points', 0); // คืนแต้ม
            throw ins.error;
          }
          await refresh(true);
          showModal({
            icon: '🎉', title: 'แลกรางวัลสำเร็จ!',
            message: '👤 ' + u.name + '\n🎁 ' + rw.name + '\n🔖 รหัส: ' + code + '\n🕒 ' + fmtTime(ins.data.created_at) +
              '\n\n📸 แคปภาพหน้าจอนี้ไว้ แล้วนำไปแลกรางวัลในโอเพ่นแชทกลุ่มได้เลย'
          });
        } catch (err) { dbError(err, 'แลกรางวัลไม่สำเร็จ'); }
      }
    });
  }

  /* ---------- ผูกเหตุการณ์ ---------- */
  function bindEvents() {
    document.querySelectorAll('.auth-tab').forEach(b => {
      b.addEventListener('click', () => setAuthTab(b.getAttribute('data-auth')));
    });
    $('toAdminLogin').addEventListener('click', () => {
      $('customerAuth').hidden = true;
      $('adminAuth').hidden = false;
      $('adminPw').focus();
    });
    $('toCustomerLogin').addEventListener('click', () => {
      $('adminAuth').hidden = true;
      $('customerAuth').hidden = false;
      $('adminLoginForm').reset();
    });

    // เข้าสู่ระบบลูกค้า
    $('loginForm').addEventListener('submit', e => {
      e.preventDefault();
      withBusy($('loginForm'), async () => {
        const name = cleanName($('loginName').value);
        const pw = $('loginPw').value;
        if (!name || !pw) {
          showModal({ icon: '🐱', title: 'ยังกรอกไม่ครบ', message: 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่านนะ' });
          return;
        }
        const r = await supabase.from('users').select('id,name,points')
          .eq('name_key', normName(name)).eq('password', hashPw(pw)).maybeSingle();
        if (r.error) throw r.error;
        if (!r.data) {
          showModal({ icon: '🐻', title: 'เข้าสู่ระบบไม่สำเร็จ', message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
          return;
        }
        me = r.data;
        setSession({ role: 'customer', uid: me.id });
        $('loginForm').reset();
        route();
        setTab('home');
        await refresh(true);
        toast('💕 ยินดีต้อนรับกลับมา ' + me.name);
      });
    });

    // สมัครสมาชิก
    $('registerForm').addEventListener('submit', e => {
      e.preventDefault();
      withBusy($('registerForm'), async () => {
        const name = cleanName($('regName').value);
        const pw = $('regPw').value;
        const pw2 = $('regPw2').value;
        if (!name || !pw || !pw2) {
          showModal({ icon: '🐱', title: 'ยังกรอกไม่ครบ', message: 'กรุณากรอกข้อมูลให้ครบทุกช่องนะ' });
          return;
        }
        if (name.length < 2) {
          showModal({ icon: '🐱', title: 'ชื่อสั้นเกินไป', message: 'ชื่อผู้ใช้งานต้องมีอย่างน้อย 2 ตัวอักษร' });
          return;
        }
        if (pw.length < 4) {
          showModal({ icon: '🐱', title: 'รหัสผ่านสั้นเกินไป', message: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
          return;
        }
        if (pw !== pw2) {
          showModal({ icon: '🐻', title: 'รหัสผ่านไม่ตรงกัน', message: 'รหัสผ่านกับช่องยืนยันไม่ตรงกัน' });
          return;
        }
        const r = await supabase.from('users')
          .insert({ name: name, name_key: normName(name), password: hashPw(pw), points: 0 })
          .select('id,name,points').single();
        if (r.error) {
          if (r.error.code === '23505') {
            showModal({ icon: '🐻', title: 'ชื่อนี้ถูกใช้แล้ว', message: 'มีคนใช้ชื่อผู้ใช้งานนี้แล้ว ลองตั้งชื่ออื่นนะ' });
            return;
          }
          throw r.error;
        }
        me = r.data;
        setSession({ role: 'customer', uid: me.id });
        $('registerForm').reset();
        setAuthTab('login');
        route();
        setTab('home');
        await refresh(true);
        toast('🎉 สมัครสมาชิกสำเร็จ ยินดีต้อนรับ ' + me.name);
      });
    });

    // เข้าสู่ระบบแอดมิน
    $('adminLoginForm').addEventListener('submit', e => {
      e.preventDefault();
      const now = Date.now();
      if (now < adminLockUntil) {
        showModal({ icon: '🔒', title: 'ลองใหม่ภายหลัง', message: 'กรอกรหัสผิดหลายครั้ง กรุณารออีก ' + Math.ceil((adminLockUntil - now) / 1000) + ' วินาที' });
        return;
      }
      if (hashPw($('adminPw').value) !== ADMIN_HASH) {
        adminFails++;
        $('adminPw').value = '';
        if (adminFails >= 5) {
          adminFails = 0;
          adminLockUntil = now + 60000;
          showModal({ icon: '🔒', title: 'ล็อกชั่วคราว', message: 'กรอกรหัสผิดครบ 5 ครั้ง ระบบล็อก 60 วินาที' });
        } else {
          showModal({ icon: '🐻', title: 'รหัสผ่านไม่ถูกต้อง', message: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
        }
        return;
      }
      adminFails = 0;
      me = null;
      setSession({ role: 'admin' });
      $('adminLoginForm').reset();
      $('adminAuth').hidden = true;
      $('customerAuth').hidden = false;
      route();
      window.scrollTo({ top: 0 });
      refresh(false);
    });

    // ออกจากระบบ
    $('logoutBtn').addEventListener('click', () => {
      showModal({
        icon: '👋', title: 'ออกจากระบบ', confirm: true, okText: 'ออกจากระบบ',
        message: 'ต้องการออกจากระบบใช่หรือไม่?',
        onOk: () => {
          clearSession();
          me = null; mySlips = []; myReds = [];
          adminData = { pending: [], done: [], reds: [], counts: { pending: 0, approved: 0, rejected: 0 }, imgCount: 0 };
          clearPreview();
          route();
          setTab('home');
        }
      });
    });

    document.querySelectorAll('.nav-btn').forEach(b => {
      b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
    });

    // โมดัล
    $('modalOk').addEventListener('click', () => {
      const cb = modalCallback;
      closeModal();
      if (cb) cb();
    });
    $('modalCancel').addEventListener('click', closeModal);
    $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
    $('imgClose').addEventListener('click', () => { $('imgModal').hidden = true; });
    $('imgModal').addEventListener('click', e => { if (e.target === $('imgModal')) $('imgModal').hidden = true; });

    // ปุ่มที่สร้างแบบไดนามิก (ใช้ event delegation)
    document.body.addEventListener('click', async e => {
      const thumb = e.target.closest('.slip-thumb');
      if (thumb) {
        const id = thumb.getAttribute('data-img');
        if (!id) return;
        let src = imgCache[id];
        if (!src) {
          const r = await supabase.from('slips').select('image').eq('id', id).maybeSingle();
          if (r.data && r.data.image) { src = r.data.image; imgCache[id] = src; }
        }
        if (src) { $('imgModalSrc').src = src; $('imgModal').hidden = false; }
        return;
      }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'approve') approveSlip(btn.getAttribute('data-id'));
      else if (act === 'reject') rejectSlip(btn.getAttribute('data-id'));
      else if (act === 'delimg') deleteSlipImage(btn.getAttribute('data-id'));
      else if (act === 'delallimg') deleteAllDoneImages();
      else if (act === 'redeem') redeemReward(Number(btn.getAttribute('data-idx')));
    });

    // เลือกรูปสลิป + Preview
    $('slipFile').addEventListener('change', () => {
      const file = $('slipFile').files[0];
      if (!file || !currentUser()) return;
      if (!/^image\//.test(file.type)) {
        showModal({ icon: '🐻', title: 'ไฟล์ไม่ถูกต้อง', message: 'กรุณาเลือกไฟล์รูปภาพเท่านั้นนะ' });
        clearPreview();
        return;
      }
      compressImage(file, dataUrl => {
        if (!dataUrl) {
          showModal({ icon: '🐻', title: 'อ่านรูปไม่ได้', message: 'ไม่สามารถอ่านรูปนี้ได้ ลองเลือกรูปอื่นดูนะ' });
          clearPreview();
          return;
        }
        pendingImage = dataUrl;
        $('slipPreview').src = dataUrl;
        $('slipPreview').hidden = false;
        $('uploadPlaceholder').hidden = true;
        $('removePreview').hidden = false;
      });
    });

    $('removePreview').addEventListener('click', e => { e.preventDefault(); clearPreview(); });

    // ส่งสลิป
    $('slipForm').addEventListener('submit', e => {
      e.preventDefault();
      withBusy($('slipForm'), async () => {
        const u = currentUser();
        if (!u) {
          showModal({ icon: '🔒', title: 'กรุณาเข้าสู่ระบบ', message: 'ต้องเข้าสู่ระบบก่อนจึงจะส่งสลิปได้นะ', onOk: route });
          return;
        }
        const amount = Number($('slipAmount').value);
        if (!amount || amount <= 0) {
          showModal({ icon: '🐱', title: 'ยังกรอกไม่ครบ', message: 'กรุณากรอกยอดเงินที่โอนให้ถูกต้องนะ' });
          return;
        }
        if (!pendingImage) {
          showModal({ icon: '🐻', title: 'ยังไม่ได้แนบสลิป', message: 'กรุณาแนบรูปสลิปโอนเงินก่อนส่งนะ' });
          return;
        }
        const r = await supabase.from('slips').insert({
          user_id: u.id, amount: Math.round(amount * 100) / 100, image: pendingImage, status: 'pending', points: 0
        }).select('id').single();
        if (r.error) throw r.error;
        imgCache[r.data.id] = pendingImage;
        $('slipForm').reset();
        clearPreview();
        await refresh(true);
        showModal({
          icon: '💌', title: 'ส่งสลิปเรียบร้อย!',
          message: 'แอดมินกำลังตรวจสอบให้นะ\nดูสถานะได้ที่เมนู "ประวัติ" 🐻',
          onOk: () => setTab('history')
        });
      });
    });

    // บันทึกโปรไฟล์ (ชื่อ + รหัสผ่านใหม่)
    $('profileForm').addEventListener('submit', e => {
      e.preventDefault();
      withBusy($('profileForm'), async () => {
        const u = currentUser();
        if (!u) return;
        const name = cleanName($('profName').value);
        const pw = $('profPw').value;
        if (!name || name.length < 2) {
          showModal({ icon: '🐱', title: 'ชื่อไม่ถูกต้อง', message: 'กรุณากรอกชื่อผู้ใช้งานอย่างน้อย 2 ตัวอักษร' });
          return;
        }
        if (pw && pw.length < 4) {
          showModal({ icon: '🐱', title: 'รหัสผ่านสั้นเกินไป', message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
          return;
        }
        const patch = { name: name, name_key: normName(name) };
        if (pw) patch.password = hashPw(pw);
        const r = await supabase.from('users').update(patch).eq('id', u.id).select('id,name,points').single();
        if (r.error) {
          if (r.error.code === '23505') {
            showModal({ icon: '🐻', title: 'ชื่อนี้ถูกใช้แล้ว', message: 'มีคนใช้ชื่อผู้ใช้งานนี้แล้ว ลองตั้งชื่ออื่นนะ' });
            return;
          }
          throw r.error;
        }
        me = r.data;
        $('profPw').value = '';
        renderAll();
        toast(pw ? '🔑 บันทึกโปรไฟล์และเปลี่ยนรหัสผ่านแล้ว' : '💕 บันทึกโปรไฟล์เรียบร้อยแล้ว');
      });
    });

    // บังคับหน้าให้ตรงกับสิทธิ์เสมอ (พิมพ์ #admin เองก็เข้าไม่ได้)
    window.addEventListener('hashchange', route);

    // ดึงข้อมูลใหม่เมื่อกลับมาที่หน้าเว็บ และทุก 20 วินาที
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
    window.addEventListener('focus', () => refresh(true));
    setInterval(() => { if (!document.hidden) refresh(true); }, POLL_MS);
  }

  /* ---------- เริ่มทำงาน ---------- */
  async function init() {
    $('authView').hidden = true;
    $('customerView').hidden = true;
    $('adminView').hidden = true;
    bindEvents();

    if (!supabase) {
      $('authView').hidden = false;
      showModal({ icon: '🐻', title: 'โหลดระบบไม่สำเร็จ', message: 'ไม่สามารถโหลดตัวเชื่อมต่อฐานข้อมูลได้\nกรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้าเว็บ' });
      return;
    }

    const sess = getSession();
    if (sess && sess.role === 'customer') {
      try {
        const r = await supabase.from('users').select('id,name,points').eq('id', sess.uid).maybeSingle();
        if (r.error) throw r.error;
        if (r.data) me = r.data; else clearSession();
      } catch (err) {
        console.error(err);
        route();
        dbError(err, 'โหลดข้อมูลบัญชีไม่สำเร็จ');
        return;
      }
    }
    route();
    refresh(true);
  }

  init();
})();