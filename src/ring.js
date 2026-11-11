/* 视频环幕（由 work/gatt-lab.html 原型整合而来）
   mountRing(stage, { awards }) → 返回 dispose()；SPA 路由切走时调用即可完全卸载。
   结构：一级 = 圆柱内壁封面环（含播放按钮、两级点击）；二级 = 全屏播放页。 */
import * as THREE from '../vendor/three.module.js';

/* 每条片子的说明文案：一个数组元素 = 一行（键为视频文件名） */
const CAPTIONS = {
  'asset-2fc99de6.mp4': ['以港式趣味与另类职场视角展开', '发布12小时内点赞量1.1W+、互动500+'],
  'asset-6ba2bcf9.mp4': ['从大众对主角情感线关注度入手', '加入音乐反转和趣味花字等记忆点'],
  'asset-80dea33f.mp4': ['艺人官方抖音共创视频'],
  'asset-968f0fae.mp4': ['拆解抖音热曲与热点内容', '结合电影名场面进行创意混剪'],
  'asset-83e126fd.mp4': ['筛查花絮，将织毛衣这一话题点与敬业结合', '规避严肃敬业宣传带来的负面舆论，总播放量35W+'],
  'asset-be7fcac6.mp4': ['从联动海报出发，结合两部电影的剧情与画面', '寻找相似点进行转场，进行新型动态海报的输出'],
  'asset-6f2f282e.mp4': ['以“大圣不妙曲”热曲入手，进行创意混剪', '宣传上美影精神与电影的独特美学'],
  '1-e0e2e9ef.mp4': ['将电影预告拆解，进行卡点混剪', '突出海战场景的精心制作和燃向家国情怀'],
  'asset-77fef66a.mp4': ['以阵容宣传为目的', '通过卡点式亮相预热电影'],
  '600-c508f195.mp4': ['结合路演与线下活动', '打造官方暖心向活动视频'],
  'asset-917029be.mp4': ['与艺人工作室合作，拆解剧集与角色', '输出日记式角色微特辑'],
  'asset-f95a4f33.mp4': ['从IP调性和联动场景入手', '通过默剧形式打造趣味intro短片'],
  'mk-ef9a1ef5.mp4': ['筛选剧场幕后素材，从剧目内容和训练片段入手', '打造从练习、打磨、敬业到登场这条完整时间线的武术特辑']
};

/* 手机端用 posters/m/ 下的小图（600px，约为原图 55% 体积），桌面用原图 */
const posterOf = src => {
  const mobile = matchMedia('(max-width: 800px)').matches;
  return (mobile ? 'posters/m/' : 'posters/') + src.split('/').pop().replace(/\.[^.]+$/, '') + '.jpg';
};

const VERT = `
uniform float uCurveAmountX;
uniform float uCurveAmountY;
uniform float uImageWidth;
uniform float uImageHeight;
uniform float uSizeFactorX;
uniform float uSizeFactorY;
uniform float uTiltAngle;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
varying vec2 vUv;
varying float fogDepth;
void main(){
  vUv = uv * uUvScale + uUvOffset;
  vec3 pos = position;
  float percentageX = (abs(pos.x) / (uImageWidth * 0.5)) * 1000.0;
  float percentageY = (abs(pos.y) / (uImageHeight * 0.5)) * 1000.0;
  pos.z += uCurveAmountX * pow(percentageX, 2.0) * 0.003 * uSizeFactorX;
  pos.z += uCurveAmountY * pow(percentageY, 2.0) * 0.003 * uSizeFactorY;
  pos.z += pos.y * tan(uTiltAngle);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  fogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}`;
const FRAG = `
uniform sampler2D uTexture;
uniform float uOpacity;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vUv;
varying float fogDepth;
void main(){
  vec4 texColor = texture2D(uTexture, vUv);
  /* 提亮：轻微 gamma 抬升暗部 + 少量增益，让封面细节更清晰 */
  texColor.rgb = pow(texColor.rgb, vec3(0.84)) * 1.07;
  float fogFactor = smoothstep(fogNear, fogFar, fogDepth);
  /* 雾色略带灰度，远端不是纯黑压死，纵深仍在但不吃掉画面 */
  texColor.rgb = mix(texColor.rgb, fogColor, fogFactor);
  texColor.a *= uOpacity;
  if (texColor.a < 0.003) discard;
  gl_FragColor = texColor;
}`;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, mi, ma) => Math.min(ma, Math.max(mi, v));
const easeInOut = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const fmtTime = t => {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
};

export function mountRing(stage, { awards = [] } = {}) {
  const pageEl = stage.closest('.ring-page') || stage.parentElement;
  const $ = id => document.getElementById(id);
  const loader = $('ring-loader'), bar = $('ring-bar'), caption = $('ring-caption');
  const playerEl = $('ring-player'), pVideo = $('rp-video'), pList = $('rp-list');
  const pFill = $('rp-fill'), pTime = $('rp-time'), pTitle = $('rp-title'), pMeta = $('rp-meta'), pIndex = $('rp-index');
  const pSound = $('rp-sound'), pPlay = $('rp-play'), pProgress = $('rp-progress');

  const clips = [];
  for (const g of awards) for (const it of g.items) {
    const src = it[3];
    if (src) clips.push({
      src, group: g.project, year: g.year, kind: it[0], tag: it[1],
      desc: CAPTIONS[src.split('/').pop()] || null,
      label: g.year + ' · ' + g.project + ' / ' + it[0] + ' — ' + it[1]
    });
  }
  if (!clips.length) { loader?.classList.add('done'); return () => {}; }

  const isMobile = matchMedia('(max-width: 800px)').matches;
  const REF_W = isMobile ? 2137 : 5760, REF_H = isMobile ? 1644 : 3100;
  const POP_ANGLE = isMobile ? 300 : 150;
  const MIN_R = 950, MAX_R = 1750;                   // 环绕半径（相机居中，卡片距 = 半径）
  const FOG_NEAR = 1450, FOG_FAR = 3600;              // 雾更晚起、更晚收，远端封面不被压暗
  const PSI_MAX = isMobile ? 22 : 26;                // 卡片可占的垂直视角半角（度）

  let disposed = false;
  let rafId = 0, introTimer = 0, hoverThrottle = 0, curIdx = -1, muted = false;
  let renderPaused = false;   // 播放页打开时暂停环幕渲染，把 GPU 让给视频解码
  const cleanup = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanup.push(() => target.removeEventListener(type, fn, opts)); };

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 24000);
  camera.position.set(0, 0, isMobile ? 1500 : 2600);

  const circumference = 2 * Math.PI * MIN_R;
  const usedCirc = circumference * (POP_ANGLE / 360);
  /* 封面尺寸与环周长解耦：scaleUp 固定，保证缩小环幕后封面投影反而更大 */
  const scaleUp = isMobile ? 1.4 : 0.95;   // 移动端竖屏视野窄，需更大封面
  const halfH = () => Math.tan(PSI_MAX * Math.PI / 180 * 0.9) * (MIN_R + MAX_R) / 2;

  const boxes = [], meshes = [];
  const CARD_SCALE = 0.62;
  const BASE_W = (isMobile ? 430 : 560) * CARD_SCALE;
  const BASE_AREA = BASE_W * (BASE_W * 9 / 16);
  const PORTRAIT_SCALE = 1.2;                        // 竖版封面额外放大，横版保持原尺寸
  let loaded = 0;

  /* 角空间排布：以「方位角 φ × 仰角 ψ」作为占位单位。
     同一角区间在两个不同景深的卡片不会在屏幕上重叠（屏幕 x ∝ tan φ、y ∝ tan ψ，单调），
     因此角空间零重叠 ⇒ 屏幕零重叠。 */
  function overlapArea(b) {
    let ov = 0;
    for (const o of boxes) {
      const w = Math.min(b.pMax, o.pMax) - Math.max(b.pMin, o.pMin);
      const h = Math.min(b.qMax, o.qMax) - Math.max(b.qMin, o.qMin);
      if (w > 0 && h > 0) ov += w * h;
    }
    return ov;
  }
  /* 槽位网格：把屏幕球角 (φ, ψ) 均分成 COLS×ROWS 个槽，洗牌后逐卡取槽并加抖动。
     相机位于环心，卡片屏幕角即 (φ, atan(y/r))，因此角空间零重叠 ⇔ 屏幕零重叠，
     且槽位与景深无关 → 分布均匀密集。 */
  const GRID_C = 5, GRID_R = 2, SLOT_JITTER = 0.12;
  const slotOrder = [];
  for (let r = 0; r < GRID_R; r++) for (let c = 0; c < GRID_C; c++) slotOrder.push({ c, r });
  for (let i = slotOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [slotOrder[i], slotOrder[j]] = [slotOrder[j], slotOrder[i]]; }
  let slotPtr = 0;
  function place(width, height, radius) {
    const halfPhi = POP_ANGLE * Math.PI / 180 / 2;
    const halfPsi = PSI_MAX * Math.PI / 180;
    const hw = Math.atan((width / 2) / radius);
    const hh = Math.atan((height / 2) / radius);
    const cellW = (2 * halfPhi) / GRID_C, cellH = (2 * halfPsi) / GRID_R;
    const trySlot = (s, sc, jit) => {
      const w = width * sc, h = height * sc;
      const hw2 = Math.atan((w / 2) / radius), hh2 = Math.atan((h / 2) / radius);
      const phi = -halfPhi + (s.c + 0.5 + (Math.random() - 0.5) * 2 * jit) * cellW;
      const psi = -halfPsi + (s.r + 0.5 + (Math.random() - 0.5) * 2 * jit) * cellH;
      const b = { pMin: phi - hw2, pMax: phi + hw2, qMin: psi - hh2, qMax: psi + hh2 };
      if (overlapArea(b) > 0) return null;
      boxes.push(b); slotPtr = (slotPtr + slotOrder.indexOf(s) + 1) % slotOrder.length;
      return { phi, psi, w, h };
    };
    for (let k = 0; k < 9; k++) {
      const sc = Math.pow(0.9, k);
      for (const jit of [SLOT_JITTER, 0]) {          /* 抖动放不下时退回槽心，减少兜底重叠 */
        for (let t = 0; t < slotOrder.length; t++) {
          const r = trySlot(slotOrder[(slotPtr + t) % slotOrder.length], sc, jit);
          if (r) return r;
        }
      }
    }
    /* 兜底 1：全槽随机重试，找到不重叠位置才放 */
    for (let t = 0; t < 300; t++) {
      const phi = -halfPhi + hw + Math.random() * Math.max(0, 2 * halfPhi - 2 * hw);
      const psi = -halfPsi + hh + Math.random() * Math.max(0, 2 * halfPsi - 2 * hh);
      const b = { pMin: phi - hw, pMax: phi + hw, qMin: psi - hh, qMax: psi + hh };
      if (overlapArea(b) <= 0) { boxes.push(b); return { phi, psi, w: width, h: height }; }
    }
    /* 兜底 2：极端情况，缩到 40% 强制放入 */
    const sc = 0.4;
    const phi = -halfPhi + hw * sc + Math.random() * Math.max(0, 2 * halfPhi - 2 * hw * sc);
    const psi = -halfPsi + hh * sc + Math.random() * Math.max(0, 2 * halfPsi - 2 * hh * sc);
    boxes.push({ pMin: phi - hw * sc, pMax: phi + hw * sc, qMin: psi - hh * sc, qMax: psi + hh * sc });
    return { phi, psi, w: width * sc, h: height * sc };
  }

  const loadImage = src => new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
  });

  /* 封面上常驻的播放按钮：白色圆环 + 三角，做成精灵贴在卡片正面，随卡片一起受雾影响 */
  const playTex = (() => {
    const S = 128, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.beginPath(); g.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,.30)'; g.fill();
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(255,255,255,.90)'; g.stroke();
    g.beginPath(); g.moveTo(54, 41); g.lineTo(89, 64); g.lineTo(54, 87); g.closePath();
    g.fillStyle = 'rgba(255,255,255,.96)'; g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  let introT = -1, introDone = false;
  const startIntro = () => { if (introT < 0) introT = 0; };
  /* 只有已经有封面时才收起加载层，避免「加载条消失但画面全黑」 */
  const finishIntro = () => { introDone = true; if (meshes.length) loader?.classList.add('done'); };

  const hFov = () => 2 * Math.atan(Math.tan(camera.fov * Math.PI / 180 / 2) * camera.aspect) * 180 / Math.PI;
  let swayStarted = false;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  let rotY = 0, posY = 0, tgtRotY = 0, tgtPosY = 0;
  let curve = 0, tilt = 0, dragRotY = 0;
  let pinned = null;
  const downPos = { x: 0, y: 0 };
  let dragging = false, lastX = 0, lastY = 0;
  let hovered = null;

  /* —— 一级：封面环 —— */
  /* 移动端竖版封面统一「画框」：等宽等高 + 同一半径 ⇒ 屏幕上视觉尺寸完全一致；
     原始比例不同的封面用 UV 居中裁切填充（cover，等比不拉伸）。 */
  const P_BOX = { w: 330, h: 552, r: 1330, aspect: 552 / 330 };

  /* 移动端专用：单排「居中横向环绕」布局。
     所有封面同一仰角（ψ=0，垂直居中成一条水平带）；
     横版按宽度降序排到更远半径（角宽度趋于一致），竖版固定半径；
     再沿方位角均匀铺开并留缝 → 角空间互不重叠 ⇒ 屏幕零重叠。 */
  function layoutRow(items) {
    const N = items.length;
    if (!N) return null;
    const arc = POP_ANGLE * Math.PI / 180;
    const meta = items.map(({ aspect }) => {
      const portrait = aspect < 1;
      if (portrait) {
        /* A = 图片宽/高，T = 画框高/宽。cover 裁切：裁切区域宽高比必须等于画框宽高比 1/T，
           即 su·A/sv = 1/T → su = sv/(A·T)；取 su=min(1,1/(A·T))、sv=min(1,A·T)，
           保证区域比例恒正确且不超过原图（等比缩放填充，居中裁边，不拉伸）。 */
        const A = aspect, T = P_BOX.aspect;
        const su = Math.min(1, 1 / (A * T)), sv = Math.min(1, A * T);
        return { portrait, w: P_BOX.w, h: P_BOX.h, r: P_BOX.r, uv: { sx: su, sy: sv, ox: (1 - su) / 2, oy: (1 - sv) / 2 } };
      }
      const z = Math.random();
      const w0 = Math.sqrt(BASE_AREA * aspect) * scaleUp * (1 + z * 0.7);
      return { portrait, w: w0, h: w0 / aspect };
    });
    /* 横版按宽度降序 → 宽卡排远半径；竖版半径已固定，不参与排序 */
    const land = meta.map((m, i) => i).filter(i => !meta[i].portrait).sort((a, b) => meta[b].w - meta[a].w);
    land.forEach((idx, rank) => {
      meta[idx].r = MIN_R + (MAX_R - MIN_R) * (land.length > 1 ? rank / (land.length - 1) : .5);
    });
    const slot = arc / N;
    for (const m of meta) {
      let hw = Math.atan((m.w / 2) / m.r);
      const maxHw = slot * .46;                       /* 相邻封面间至少留 8% 缝隙 */
      if (hw > maxHw) { const s = maxHw / hw; m.w *= s; m.h *= s; hw = maxHw; }
      m.hw = hw;
    }
    const used = meta.reduce((s, m) => s + 2 * m.hw, 0);
    const gap = Math.max(.004, (arc - used) / N);
    /* 从正前方（phi=0）向两侧交替排布：初始视角正中恰好是一张封面 */
    meta[0].phi = 0;
    let rC = 0, rHw = meta[0].hw, lC = 0, lHw = meta[0].hw;
    for (let k = 1; k < N; k++) {
      const m = meta[k];
      if (k % 2) { m.phi = rC + rHw + gap + m.hw; rC = m.phi; rHw = m.hw; }
      else { m.phi = lC - lHw - gap - m.hw; lC = m.phi; lHw = m.hw; }
    }
    return meta;
  }

  function buildCards(items) {
    const plan = isMobile ? layoutRow(items) : null;
    items.forEach(({ clip, aspect, im }, idx) => {
      let width, height, radius, pos, uv = null;
      if (plan) {
        const p = plan[idx];
        width = p.w; height = p.h; radius = p.r; uv = p.uv || null;
        pos = { phi: p.phi, psi: 0, w: p.w, h: p.h };
      } else {
        const z = Math.random();
        const portrait = aspect < 1;
        /* 竖版整体 1.2 倍，但随机增幅收窄，避免极端大卡挤不进槽位 */
        const grow = portrait ? 1 + z * 0.45 : 1 + z * 0.7;
        const w0 = Math.sqrt(BASE_AREA * aspect) * scaleUp * grow * (portrait ? PORTRAIT_SCALE : 1);
        const h0 = w0 / aspect;
        radius = MIN_R + (MAX_R - MIN_R) * z;
        pos = place(w0, h0, radius);
        width = pos.w; height = pos.h;
      }
      const angle = -Math.PI / 2 + pos.phi;
      const geo = new THREE.PlaneGeometry(width, height, isMobile ? 10 : 20, isMobile ? 10 : 20);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false,
        uniforms: {
          uCurveAmountX: { value: 0 }, uCurveAmountY: { value: 0 },
          uImageWidth: { value: width }, uImageHeight: { value: height },
          uSizeFactorX: { value: width / 2000 }, uSizeFactorY: { value: height / 2000 },
          uTiltAngle: { value: 0 }, uTexture: { value: null },
          uUvScale: { value: new THREE.Vector2(uv ? uv.sx : 1, uv ? uv.sy : 1) },
          uUvOffset: { value: new THREE.Vector2(uv ? uv.ox : 0, uv ? uv.oy : 0) },
          uOpacity: { value: 0 },
          fogColor: { value: new THREE.Color(0x121212) }, fogNear: { value: FOG_NEAR }, fogFar: { value: FOG_FAR }
        }
      });
      const tex = new THREE.Texture(im);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      mat.uniforms.uTexture.value = tex;

      const mesh = new THREE.Mesh(geo, mat);
      /* 球面放置：卡片位于以相机为球心、半径 radius 的球面上，
         屏幕角恰为 (phi, psi)，与槽位严格对应；正对相机无透视斜切 */
      const cp = Math.cos(pos.psi);
      mesh.position.set(radius * cp * Math.cos(angle), radius * Math.sin(pos.psi), radius * cp * Math.sin(angle));
      mesh.lookAt(0, 0, 0);
      mesh.userData = { clip, angle, baseOpacity: 1, q0: mesh.quaternion.clone() };

      const iconSize = Math.min(width, height) * 0.20;
      const play = new THREE.Sprite(new THREE.SpriteMaterial({
        map: playTex, transparent: true, depthWrite: false, opacity: 0, fog: true
      }));
      play.scale.set(iconSize, iconSize, 1);
      play.position.set(0, 0, 3);
      mesh.add(play);
      mesh.userData.playSprite = play;

      scene.add(mesh);
      meshes.push(mesh);
      if (window.RING_DEBUG) console.log('[ring]', 'r=' + Math.round(radius), 'phi=' + (pos.phi * 180 / Math.PI).toFixed(1), 'psi=' + (pos.psi * 180 / Math.PI).toFixed(1), 'w=' + Math.round(width), 'h=' + Math.round(height), clip.src.split('/').pop());
    });
    /* 入场动画已结束才拿到封面（慢网络）：直接置为可见，否则透明度会永远停在 0 */
    if (introDone) {
      for (const m of meshes) m.material.uniforms.uOpacity.value = m.userData.baseOpacity;
      loader?.classList.add('done');
    } else {
      /* 封面就绪即收起加载层，让入场动画（淡入＋推近）直接可见，而不是再等 3.5 秒黑屏 */
      setTimeout(() => loader?.classList.add('done'), 300);
    }
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(x, y) {
    ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object : null;
  }

  /* 透明度分配：选中态 > 悬停态 > 默认 */
  function refreshDim() {
    for (const m of meshes) {
      let to = m.userData.baseOpacity;
      if (pinned) to = (m === pinned) ? 1 : 0.14;
      else if (hovered) to = (m.userData.clip.group !== hovered.userData.clip.group) ? 0.12 : m.userData.baseOpacity;
      m.userData.targetOpacity = to;
    }
  }
  function setHover(m) {
    hovered = m;
    document.body.style.cursor = m ? 'pointer' : '';
    refreshDim();
  }
  /* 第一次点击：把封面转到正中并锁定，其余卡片退暗 */
  function pin(m) {
    pinned = m;
    const a = m.userData.angle;
    const face = Math.atan2(-Math.cos(a), -Math.sin(a));
    tgtRotY = face; dragRotY = face;
    tgtPosY = clamp(m.position.y, -halfH(), halfH());
    if (caption) {
      caption.textContent = '点击播放 · ' + m.userData.clip.group;
      caption.classList.add('show');
    }
    refreshDim();
  }
  function unpin() {
    if (!pinned) return;
    pinned = null;
    caption?.classList.remove('show');
    refreshDim();
  }

  /* —— 二级：播放页 —— */
  function syncUI() {
    const c = clips[curIdx];
    if (!c) return;
    const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const lines = c.desc && c.desc.length ? c.desc : [`${c.year} · ${c.kind} / ${c.tag}`];
    pTitle.textContent = c.group;
    pMeta.innerHTML = lines.map(esc).join('<br>');
    pIndex.textContent = `${String(curIdx + 1).padStart(2, '0')} / ${String(clips.length).padStart(2, '0')}`;
    pList.querySelectorAll('.thumb').forEach(t => t.classList.toggle('active', +t.dataset.i === curIdx));
    const act = pList.querySelector('.thumb.active');
    if (act) act.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  function openClip(i) {
    if (i < 0 || i >= clips.length) return;
    curIdx = i;
    const c = clips[i];
    pVideo.src = c.src;
    pVideo.poster = posterOf(c.src);
    pVideo.muted = muted;
    pVideo.currentTime = 0;
    pVideo.play().then(() => { pPlay.textContent = '❚❚'; })
      .catch(() => { pVideo.muted = true; muted = true; pSound.textContent = '静音'; pVideo.play().catch(() => {}); });
    syncUI();
    playerEl.classList.add('open');
    pageEl?.classList.add('is-playing');
    playerEl.setAttribute('aria-hidden', 'false');
    renderPaused = true;   // 停掉环幕渲染（下一帧起不再排队）
  }
  function resumeRender() {
    if (disposed || !renderPaused) return;
    renderPaused = false;
    if (rafId) return;
    clock.getDelta();                       // 吃掉暂停期间累积的时间，避免恢复首帧跳变
    rafId = requestAnimationFrame(frame);
  }
  function closePlayer() {
    if (curIdx < 0) return;
    playerEl.classList.remove('open');
    playerEl.setAttribute('aria-hidden', 'true');
    pageEl?.classList.remove('is-playing');
    pVideo.pause();
    curIdx = -1;
    resumeRender();
  }
  function togglePlay() {
    if (pVideo.paused) { pVideo.play().catch(() => {}); pPlay.textContent = '❚❚'; }
    else { pVideo.pause(); pPlay.textContent = '▶'; }
  }

  if (pList && !pList.childElementCount) {
    pList.innerHTML = clips.map((c, i) =>
      `<button class="thumb" data-i="${i}" title="${c.label}"><img src="${posterOf(c.src)}" alt=""><span>${String(i + 1).padStart(2, '0')}</span></button>`
    ).join('');
    pList.querySelectorAll('.thumb').forEach(b => b.addEventListener('click', () => openClip(+b.dataset.i)));
  }

  const q = (id) => document.getElementById(id);
  q('rp-close')?.addEventListener('click', closePlayer);
  q('rp-prev')?.addEventListener('click', () => openClip((curIdx - 1 + clips.length) % clips.length));
  q('rp-next')?.addEventListener('click', () => openClip((curIdx + 1) % clips.length));
  pPlay?.addEventListener('click', togglePlay);
  pVideo?.addEventListener('click', togglePlay);
  pVideo?.addEventListener('play', () => pPlay.textContent = '❚❚');
  pVideo?.addEventListener('pause', () => pPlay.textContent = '▶');
  pSound?.addEventListener('click', () => {
    muted = !muted;
    pVideo.muted = muted;
    pSound.textContent = muted ? '静音' : '有声';
  });
  pVideo?.addEventListener('timeupdate', () => {
    const d = pVideo.duration || 0;
    pFill.style.width = (d ? (pVideo.currentTime / d * 100) : 0) + '%';
    pTime.textContent = fmtTime(pVideo.currentTime) + ' / ' + fmtTime(d);
  });
  pVideo?.addEventListener('loadedmetadata', () => { pTime.textContent = '0:00 / ' + fmtTime(pVideo.duration); });
  pProgress?.addEventListener('click', e => {
    const r = pProgress.getBoundingClientRect();
    if (pVideo.duration) pVideo.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * pVideo.duration;
  });

  /* —— 交互 —— */
  on(renderer.domElement, 'click', e => {
    if (!introDone) return;
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;   // 拖拽结束的 click 不算点击
    const m = pickAt(e.clientX, e.clientY);
    if (!m) { unpin(); return; }                                                // 点空白：取消选中
    if (m === pinned) { openClip(clips.indexOf(m.userData.clip)); return; }      // 第二次点击：进入播放页
    pin(m);                                                                     // 第一次点击：固定到正中
  });

  on(window, 'pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    downPos.x = e.clientX; downPos.y = e.clientY;
  });
  on(window, 'pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (pinned && Math.abs(dx) + Math.abs(dy) > 3) unpin();   // 一旦真的拖拽就释放选中
    dragRotY -= dx / innerWidth * 2.2;
    tgtPosY = clamp(posY + dy * 3, -halfH(), halfH());
    tgtRotY = dragRotY;
  });
  on(window, 'pointerup', () => { dragging = false; });
  on(window, 'mousemove', e => {
    const nx = e.clientX, ny = e.clientY;
    const vx = Math.abs(nx - mouse.x), vy = Math.abs(ny - mouse.y);
    curve = clamp(lerp(curve, .3, clamp(vx * 2 / 500, 0, .3)), 0, .3);
    tilt = clamp(tilt + clamp(vy / 40, -.06, .06), -.5, .5);
    mouse.x = nx; mouse.y = ny;
    /* 仅 PC：同上，避免移动端点击（合成 mousemove）把视角重置回初始位置 */
    if (!dragging && introDone && !pinned && !isMobile) {
      swayStarted = true;
      const maxRot = THREE.MathUtils.degToRad(135 - hFov() / 2);
      tgtRotY = -(mouse.x / innerWidth * 2 - 1) * maxRot;
      tgtPosY = (-(mouse.y / innerHeight) * 2 + 1) * halfH();
    }
    const now = performance.now();
    if (now - hoverThrottle >= 90 && introDone && !dragging) { hoverThrottle = now; setHover(pickAt(nx, ny)); }
  });
  on(window, 'mouseleave', () => setHover(null));
  on(window, 'keydown', e => {
    if (curIdx < 0) return;
    if (e.key === 'Escape') closePlayer();
    else if (e.key === 'ArrowLeft') { e.preventDefault(); openClip((curIdx - 1 + clips.length) % clips.length); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); openClip((curIdx + 1) % clips.length); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'm' || e.key === 'M') pSound?.click();
  });
  on(window, 'resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* —— 加载与渲染 —— */
  (async () => {
    /* 并行下载全部封面：串行 await 会把每张图的往返延迟叠加（慢网下可达 10s+） */
    const results = await Promise.all(clips.map(async clip => {
      const im = await loadImage(posterOf(clip.src));
      loaded++;
      if (bar) bar.style.width = (loaded / clips.length * 100) + '%';
      return im ? { clip, aspect: im.naturalWidth / im.naturalHeight || 16 / 9, im } : null;
    }));
    if (disposed) return;
    const items = results.filter(Boolean);
    if (!items.length) { loader?.classList.add('done'); return; }
    buildCards(items);
    startIntro();
  })();
  /* 兜底：极端情况下（图片挂住）也要开始动画，避免一直停在加载层 */
  introTimer = setTimeout(startIntro, 12000);
  cleanup.push(() => clearTimeout(introTimer));

  const clock = new THREE.Clock();
  function frame() {
    if (disposed) return;
    if (renderPaused) { rafId = 0; return; }
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);

    if (introT >= 0 && !introDone) {
      introT += dt;
      /* 手机端入场更快：总时长 2.2s、淡入 1.4s，避免加载层收起后长时间偏黑；桌面维持 3.5s/3s */
      const INTRO_D = isMobile ? 2.2 : 3.5, INTRO_FADE = isMobile ? 1.4 : 3;
      const p = clamp(introT / INTRO_D, 0, 1);
      camera.position.z = lerp(isMobile ? 1750 : 3050, 0, easeInOut(p));
      for (const m of meshes) m.material.uniforms.uOpacity.value = lerp(0, m.userData.baseOpacity, clamp((introT - .15) / INTRO_FADE, 0, 1));
      const q2 = easeInOut(clamp((introT - (INTRO_D - 1)) / 1, 0, 1));
      const Y = new THREE.Vector3(0, 1, 0);
      for (const m of meshes) {
        const dir = (m.position.x < 0 ? 1 : -1) * Math.PI / 8 * (1 - q2);
        const tilted = new THREE.Quaternion().setFromAxisAngle(Y, dir).multiply(m.userData.q0);
        m.quaternion.copy(tilted);
      }
      if (p >= 1) { finishIntro(); swayStarted = true; }
    }

    if (introDone) {
      /* 仅 PC：视角跟随鼠标摇摆；移动端无鼠标，若同样覆写会把拖拽后的视角拉回初始位置 */
      if (!dragging && !pinned && swayStarted && !isMobile) {
        const maxRot = THREE.MathUtils.degToRad(135 - hFov() / 2);
        tgtRotY = -(mouse.x / innerWidth * 2 - 1) * maxRot;
        tgtPosY = (-(mouse.y / innerHeight) * 2 + 1) * halfH();
      }
      rotY = lerp(rotY, tgtRotY, 1 - Math.exp(-dt * 2.2));
      posY = lerp(posY, tgtPosY, 1 - Math.exp(-dt * 2.2));
      camera.rotation.y = rotY;
      camera.position.y = posY;
      curve = lerp(curve, 0, 1 - Math.exp(-dt * 3));
      tilt = lerp(tilt, 0, 1 - Math.exp(-dt * 2));
      for (const m of meshes) {
        m.material.uniforms.uCurveAmountX.value = curve;
        m.material.uniforms.uCurveAmountY.value = curve * .35;
        m.material.uniforms.uTiltAngle.value = tilt;
        const to = m.userData.targetOpacity ?? m.userData.baseOpacity;
        m.material.uniforms.uOpacity.value = lerp(m.material.uniforms.uOpacity.value, to, 1 - Math.exp(-dt * 4));
      }
    }

    // 播放按钮透明度跟随卡片：选中/悬停最亮，其余稍弱，随雾淡出
    for (const m of meshes) {
      const op = m.material.uniforms.uOpacity.value;
      m.userData.playSprite.material.opacity = Math.min(1, op * (m === pinned || m === hovered ? 1.12 : 0.74));
    }

    renderer.render(scene, camera);
  }
  frame();

  /* —— 调试钩子（自动化验证用） —— */
  window.__ring = {
    count: () => meshes.length,
    ready: () => introDone,
    state: () => ({
      pinned: pinned ? meshes.indexOf(pinned) : -1,
      pinnedClip: pinned ? pinned.userData.clip.group : null,
      rotY: Math.round(camera.rotation.y * 1000) / 1000,
      icons: meshes.filter(m => m.userData.playSprite).length,
      dims: meshes.map(m => Math.round((m.userData.targetOpacity ?? 0.92) * 100) / 100),
      caption: caption?.classList.contains('show') ? caption.textContent : ''
    }),
    screen: i => {
      const m = meshes[i]; if (!m) return null;
      const v = new THREE.Vector3(0, 0, 0).applyMatrix4(m.matrixWorld).project(camera);
      return { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight), visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, clip: m.userData.clip.group };
    },
    angleOf: i => meshes[i] ? Math.round(Math.atan2(-Math.cos(meshes[i].userData.angle), -Math.sin(meshes[i].userData.angle)) * 1000) / 1000 : null,
    sizes: () => meshes.map(m => ({
      w: Math.round(m.geometry.parameters.width), h: Math.round(m.geometry.parameters.height),
      r: Math.round(Math.hypot(m.position.x, m.position.y, m.position.z)), clip: m.userData.clip.group
    })),
    pick: (x, y) => { const m = pickAt(x, y); return m ? meshes.indexOf(m) : -1; },
    clips: () => clips.map(c => c.src.split('/').pop())
  };
  window.__player = {
    open: openClip, close: closePlayer,
    state: () => ({
      open: playerEl.classList.contains('open'), idx: curIdx,
      src: pVideo.currentSrc || pVideo.src, paused: pVideo.paused, muted: pVideo.muted,
      order: clips.map(c => c.src.split('/').pop())
    })
  };

  return function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    cleanup.forEach(fn => fn());
    document.body.style.cursor = '';
    pVideo?.pause();
    pVideo?.removeAttribute('src');
    for (const m of meshes) {
      m.geometry.dispose();
      m.userData.playSprite?.material.dispose();
      m.material.uniforms.uTexture.value?.dispose();
      m.material.dispose();
    }
    playTex.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    if (renderer.domElement.parentNode === stage) stage.removeChild(renderer.domElement);
    delete window.__ring; delete window.__player;
    onCleanupPage();
  };

  function onCleanupPage() {
    pageEl?.classList.remove('is-playing');
    playerEl?.classList.remove('open');
    playerEl?.setAttribute('aria-hidden', 'true');
  }
}
