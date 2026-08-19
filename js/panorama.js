window.YPanorama = (() => {
  let apiPromise = null;
  let panorama = null;
  let lastRequest = null;
  let lastTrigger = null;
  let requestSerial = 0;

  const dialog = document.getElementById('panoramaDialog');
  const title = document.getElementById('panoramaTitle');
  const viewer = document.getElementById('naverPanorama');
  const stage = viewer.closest('.panorama-stage');
  const status = document.getElementById('panoramaStatus');
  const meta = document.getElementById('panoramaMeta');
  const closeButton = document.getElementById('panoramaClose');
  const retryButton = document.getElementById('panoramaRetry');
  const resizeHandle = document.getElementById('panoramaResize');
  let resizeDrag = null;
  let resizeFrame = 0;

  function showStatus(message, state = 'loading', retry = false) {
    status.textContent = message;
    status.className = `panorama-status ${state}`;
    status.hidden = false;
    retryButton.hidden = !retry;
  }

  function hideStatus() {
    status.hidden = true;
    retryButton.hidden = true;
  }

  function script(id, source, ready) {
    if (ready()) return Promise.resolve();
    document.getElementById(id)?.remove();
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      const timer = window.setTimeout(() => {
        element.remove();
        reject(new Error('네이버 지도 API 응답 시간이 초과되었습니다.'));
      }, 15000);
      const finish = (callback) => {
        window.clearTimeout(timer);
        callback();
      };
      element.id = id;
      element.src = source;
      element.async = true;
      element.onload = () => finish(() => ready()
        ? resolve()
        : reject(new Error('네이버 지도 API를 초기화하지 못했습니다.')));
      element.onerror = () => finish(() => {
        element.remove();
        reject(new Error('네이버 지도 API를 불러오지 못했습니다.'));
      });
      document.head.appendChild(element);
    });
  }

  async function loadApi() {
    if (window.naver?.maps?.Panorama) return;
    if (apiPromise) return apiPromise;
    const clientId = APP_CONFIG.naverMapsClientId;
    if (!clientId) throw new Error('네이버 Maps Client ID가 설정되지 않았습니다.');
    apiPromise = (async () => {
      await script(
        'naver-maps-core',
        `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`,
        () => Boolean(window.naver?.maps?.LatLng)
      );
      await script(
        'naver-maps-panorama',
        'https://oapi.map.naver.com/openapi/v3/maps-panorama.js',
        () => Boolean(window.naver?.maps?.Panorama)
      );
    })().catch((error) => {
      apiPromise = null;
      throw error;
    });
    return apiPromise;
  }

  function resize() {
    if (!panorama || dialog.hidden) return;
    const box = stage.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width && height) panorama.setSize(new naver.maps.Size(width, height));
  }

  function scheduleResize() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }

  function sizeLimits() {
    const mobile = window.matchMedia('(max-width:760px)').matches;
    const maxWidth = Math.max(280, window.innerWidth - (mobile ? 0 : 32));
    const maxHeight = Math.max(260, window.innerHeight - (mobile ? 0 : 80));
    return {
      minWidth: mobile ? maxWidth : Math.min(360, maxWidth),
      minHeight: Math.min(300, maxHeight),
      maxWidth,
      maxHeight
    };
  }

  function setDialogSize(width, height) {
    const limits = sizeLimits();
    dialog.style.width = `${Math.max(limits.minWidth, Math.min(limits.maxWidth, width))}px`;
    dialog.style.height = `${Math.max(limits.minHeight, Math.min(limits.maxHeight, height))}px`;
    scheduleResize();
  }

  function startResize(event) {
    event.preventDefault();
    const box = dialog.getBoundingClientRect();
    resizeDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: box.width, height: box.height };
    resizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('panorama-resizing');
  }

  function moveResize(event) {
    if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
    setDialogSize(
      resizeDrag.width + resizeDrag.x - event.clientX,
      resizeDrag.height + resizeDrag.y - event.clientY
    );
  }

  function stopResize(event) {
    if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
    resizeHandle.releasePointerCapture?.(event.pointerId);
    resizeDrag = null;
    document.body.classList.remove('panorama-resizing');
  }

  function resizeWithKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 24;
    const box = dialog.getBoundingClientRect();
    const width = box.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0);
    const height = box.height + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
    setDialogSize(width, height);
  }

  function resetDialogSize() {
    dialog.style.removeProperty('width');
    dialog.style.removeProperty('height');
    scheduleResize();
  }

  function updateMeta() {
    const location = panorama?.getLocation?.();
    if (!location) return;
    meta.textContent = [location.title, location.address, location.photodate ? `촬영 ${location.photodate}` : '']
      .filter(Boolean).join(' · ') || '가장 가까운 거리뷰를 표시하고 있습니다.';
  }

  function bindPanoramaEvents() {
    naver.maps.Event.addListener(panorama, 'pano_status', (result) => {
      if (dialog.hidden) return;
      if (result === 'OK') {
        panorama.setVisible(true);
        updateMeta();
        hideStatus();
        scheduleResize();
      } else {
        panorama.setVisible(false);
        showStatus('선택 위치 반경 300m 안에서 제공되는 네이버 거리뷰를 찾지 못했습니다.', 'empty', true);
      }
    });
    naver.maps.Event.addListener(panorama, 'pano_changed', updateMeta);
  }

  async function open({ lat, lng, label = '선택 위치' }) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    lastRequest = { lat: latitude, lng: longitude, label };
    lastTrigger = document.activeElement;
    const serial = ++requestSerial;
    title.textContent = label;
    meta.textContent = `선택 좌표 ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · 반경 300m 검색`;
    dialog.hidden = false;
    showStatus('네이버 거리뷰를 준비하는 중입니다.');
    closeButton.focus();
    try {
      await loadApi();
      if (serial !== requestSerial || dialog.hidden) return false;
      const position = new naver.maps.LatLng(latitude, longitude);
      if (!panorama) {
        panorama = new naver.maps.Panorama(viewer, {
          position,
          visible: false,
          flightSpot: false,
          zoomControl: true,
          pov: { pan: 0, tilt: 0, fov: 100 }
        });
        bindPanoramaEvents();
      } else {
        panorama.setVisible(false);
        panorama.setPosition(position);
      }
      scheduleResize();
      return true;
    } catch (error) {
      console.error(error);
      showStatus(`${error.message} Maps 애플리케이션의 Client ID와 Web 서비스 URL을 확인해 주세요.`, 'error', true);
      return false;
    }
  }

  function close({ restoreFocus = true } = {}) {
    requestSerial += 1;
    panorama?.setVisible(false);
    dialog.hidden = true;
    if (restoreFocus && lastTrigger?.focus) lastTrigger.focus();
    lastTrigger = null;
  }

  closeButton.addEventListener('click', close);
  retryButton.addEventListener('click', () => lastRequest && open(lastRequest));
  resizeHandle.addEventListener('pointerdown', startResize);
  resizeHandle.addEventListener('pointermove', moveResize);
  resizeHandle.addEventListener('pointerup', stopResize);
  resizeHandle.addEventListener('pointercancel', stopResize);
  resizeHandle.addEventListener('keydown', resizeWithKeyboard);
  resizeHandle.addEventListener('dblclick', resetDialogSize);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !dialog.hidden) close(); });
  window.addEventListener('resize', () => {
    if (!dialog.hidden && (dialog.style.width || dialog.style.height)) {
      const box = dialog.getBoundingClientRect();
      setDialogSize(box.width, box.height);
    } else scheduleResize();
  });
  if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(stage);

  return { open, close };
})();
