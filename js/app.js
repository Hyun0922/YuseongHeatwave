(async () => {
  const files = APP_CONFIG.dataFiles;
  const data = { ...(window.EMBEDDED_DATA || {}) };
  const pendingLoads = new Map();
  const loading = {
    root: document.getElementById('loading'),
    title: document.getElementById('loadingTitle'),
    detail: document.getElementById('loadingDetail'),
    retry: document.getElementById('loadingRetry')
  };
  function showLoading(title, detail = '잠시만 기다려 주세요.', retryAction = null, isError = false) {
    loading.title.textContent = title;
    loading.detail.textContent = detail;
    loading.retry.hidden = !retryAction;
    loading.retry.onclick = retryAction;
    loading.root.classList.toggle('is-error', isError);
    loading.root.hidden = false;
  }
  function hideLoading() {
    loading.root.hidden = true;
    loading.root.classList.remove('is-error');
    loading.retry.hidden = true;
    loading.retry.onclick = null;
  }
  function loadKey(key) {
    if (data[key]) return Promise.resolve(data[key]);
    if (pendingLoads.has(key)) return pendingLoads.get(key);
    const task = fetch(files[key])
      .then((response) => {
        if (!response.ok) throw new Error(`${files[key]} 응답 오류 (${response.status})`);
        return response.json();
      })
      .then((value) => {
        data[key] = value;
        return value;
      })
      .finally(() => pendingLoads.delete(key));
    pendingLoads.set(key, task);
    return task;
  }
  async function prepare(keys, title, action, retryAction) {
    const missing = keys.filter((key) => !data[key]);
    if (missing.length) showLoading(title);
    try {
      await Promise.all(missing.map(loadKey));
      if (action) await action();
      hideLoading();
      return true;
    } catch (error) {
      console.error(error);
      showLoading('자료를 불러오지 못했습니다.', error?.message || '네트워크 상태를 확인한 뒤 다시 시도해 주세요.', retryAction, true);
      return false;
    }
  }
  window.APP = { data };
  const initialReady = await prepare(
    Object.keys(files),
    '전체 지도 자료를 한 번에 불러오는 중입니다.',
    () => YMaps.init(window.APP),
    () => window.location.reload()
  );
  if (!initialReady) return;
  const S = data.summary;
  const num = (v, d = 1) => v == null || Number.isNaN(Number(v)) ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const avg = (rows, key) => rows.length ? rows.reduce((a, x) => a + (Number(x[key]) || 0), 0) / rows.length : null;
  const pct = (a, b) => b ? a / b * 100 : 0;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  document.getElementById('kpis').innerHTML = [
    ['거주 분석격자', S.counts.residential], ['활동 분석격자', S.counts.activity],
    ['종합취약지역', S.counts.joint_vulnerable], ['우선확대관리', S.counts.priority_expansion],
    ['LST 30m 픽셀', S.counts.lst_pixels]
  ].map((x) => `<div class="kpi"><b>${Number(x[1]).toLocaleString()}</b><span>${x[0]}</span></div>`).join('');

  YCharts.bars(document.getElementById('dongGrade5'), S.dong_summary.map((x) => ({ ...x, total: x.resi_grade5 + x.activity_grade5 })).sort((a, b) => b.total - a.total), 'total', 'dong');
  YCharts.grades(document.getElementById('resiGrades'), S.grade_distribution.residential);
  YCharts.grades(document.getElementById('actGrades'), S.grade_distribution.activity);
  YCharts.matrix(document.getElementById('crossMatrix'), S.cross_table);
  YCharts.scatter(document.getElementById('scatter'), data.diagnosis.features);

  const metric = document.getElementById('metricSelect');
  const metricDataKeys = (value) => ['activity', 'climate', 'act_sensitivity', 'act_response'].includes(value)
    ? ['activity']
    : value === 'diagnosis' ? ['diagnosis'] : [];
  async function selectMetric(value) {
    return prepare(
      metricDataKeys(value),
      '선택한 지도 지표를 불러오는 중입니다.',
      () => YMaps.setMetric(value),
      () => selectMetric(value)
    );
  }
  metric.onchange = () => selectMetric(metric.value);
  document.querySelectorAll('#gradeSeg button').forEach((b) => { b.onclick = () => YMaps.setGrade(b.dataset.grade); });
  document.getElementById('dongSelect').innerHTML = '<option value="">전체 행정동</option>' + S.dong_summary.map((x) => `<option>${x.dong}</option>`).join('');
  document.getElementById('dongSelect').onchange = (e) => YMaps.setDong(e.target.value);
  document.getElementById('baseSelect').onchange = (e) => YMaps.setBase(e.target.value);
  async function searchGrid() {
    const gridId = document.getElementById('gridSearch').value;
    if (!gridId.trim()) return;
    if (YMaps.searchGrid(gridId)) return;
    await prepare(
      ['activity', 'diagnosis'],
      '전체 격자에서 검색하는 중입니다.',
      () => { if (!YMaps.searchGrid(gridId)) alert('격자코드를 찾지 못했습니다.'); },
      searchGrid
    );
  }
  document.getElementById('gridSearchBtn').onclick = searchGrid;
  document.getElementById('gridSearch').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('gridSearchBtn').click(); };
  document.querySelectorAll('.framework .card').forEach((c) => {
    const activate = () => { openTab('map'); selectMetric(c.dataset.metric); };
    c.setAttribute('role', 'button');
    c.tabIndex = 0;
    c.onclick = activate;
    c.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    };
  });
  document.getElementById('openMap').onclick = () => openTab('map');

  const policyTypes = Object.keys(APP_CONFIG.policyColors);
  const policySelect = document.getElementById('policyTypeSelect');
  policySelect.innerHTML = policyTypes.map((t) => `<option>${t}</option>`).join('');
  policySelect.onchange = (e) => YMaps.setPolicyType(e.target.value);
  document.querySelectorAll('#roadLayerControls input').forEach((c) => { c.onchange = () => YMaps.setRoadLayer(c.value, c.checked); });
  document.getElementById('lstMetric').onchange = (e) => YMaps.setLSTMetric(e.target.value);
  document.getElementById('lstToggleBtn').onclick = () => YMaps.toggleLST();

  let compareInitialized = false;
  function initCompare() {
  if (window.YCompare) {
    window.YCompare.init({
      data, num, pct, esc,
      openDong: (dong) => {
        openTab('map');
        document.getElementById('dongSelect').value = dong;
        YMaps.setDong(dong);
      }
    });
    return;
  }
  if (compareInitialized) return;
  compareInitialized = true;
  // Region comparison: combine all public grid indicators and expose both selected-area and district-wide context.
  const dongNames = S.dong_summary.map((x) => x.dong);
  const group = (features, key) => {
    const out = Object.fromEntries(dongNames.map((d) => [d, []]));
    features.forEach((f) => { const d = f.properties[key]; if (out[d]) out[d].push(f.properties); });
    return out;
  };
  const resGroup = group(data.residential.features, 'dong');
  const actGroup = group(data.activity.features, 'dong');
  const diagGroup = group(data.diagnosis.features, 'dong_res');
  const baseStats = {};
  dongNames.forEach((d) => {
    const r = resGroup[d] || [], a = actGroup[d] || [], g = diagGroup[d] || [];
    const res45 = r.filter((x) => Number(x.grade) >= 4).length;
    const act45 = a.filter((x) => Number(x.grade) >= 4).length;
    const joint = g.filter((x) => x.diagnosis === '종합취약지역').length;
    const priority = g.filter((x) => x.diagnosis === '우선확대관리지역').length;
    const resOnly = g.filter((x) => x.diagnosis === '거주 단독 5등급').length;
    const actOnly = g.filter((x) => x.diagnosis === '활동 단독 5등급').length;
    const riskCount = joint + priority + resOnly + actOnly;
    const resMean = avg(r, 'score'), actMean = avg(a, 'score');
    baseStats[d] = {
      dong: d, resN: r.length, actN: a.length, commonN: g.length,
      resMean, actMean, combinedMean: avg(g, 'combined_score'),
      res45, act45, res45Rate: pct(res45, r.length), act45Rate: pct(act45, a.length),
      res5: r.filter((x) => Number(x.grade) === 5).length,
      act5: a.filter((x) => Number(x.grade) === 5).length,
      joint, priority, resOnly, actOnly, riskCount, riskRate: pct(riskCount, g.length),
      indexGap: (actMean ?? 0) - (resMean ?? 0),
      climateRes: avg(r, 'climate'), sensitivityRes: avg(r, 'sensitivity'), responseRes: avg(r, 'response_lack'),
      climateAct: avg(a, 'climate'), sensitivityAct: avg(a, 'sensitivity'), responseAct: avg(a, 'response_lack')
    };
  });
  function applyRanks(key, rankKey) {
    Object.values(baseStats).sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity)).forEach((x, i) => { x[rankKey] = i + 1; });
  }
  applyRanks('resMean', 'resRank'); applyRanks('actMean', 'actRank'); applyRanks('combinedMean', 'combinedRank'); applyRanks('riskRate', 'riskRank');

  const compareSelects = [...document.querySelectorAll('.compare-select')];
  compareSelects.forEach((s) => {
    s.innerHTML = '<option value="">지역 선택</option>' + dongNames.map((d) => `<option value="${d}">${d}</option>`).join('');
    s.onchange = renderCompare;
  });
  const defaultDongs = ['온천2동', '관평동', '온천1동', '신성동'];
  compareSelects.forEach((s, i) => { s.value = defaultDongs[i] || ''; });
  document.getElementById('compareTopBtn').onclick = () => {
    const top = Object.values(baseStats).sort((a, b) => (b.combinedMean ?? 0) - (a.combinedMean ?? 0)).slice(0, 4);
    compareSelects.forEach((s, i) => { s.value = top[i]?.dong || ''; }); renderCompare();
  };
  document.getElementById('compareResetBtn').onclick = () => { compareSelects.forEach((s) => { s.value = ''; }); renderCompare(); };
  document.getElementById('compareRankMetric').onchange = renderAllDongRank;

  function compareBar(label, value, color, suffix = '점') {
    const width = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="compare-bar-row"><span>${label}</span><div class="compare-bar-track"><i style="width:${width}%;background:var(--nav)"></i></div><b>${num(value)}${suffix}</b></div>`;
  }
  function dongInterpret(x) {
    const gap = x.indexGap;
    const type = Math.abs(gap) < 2 ? '두 지수가 비슷한 복합형' : gap > 0 ? '보행·활동 노출 우세형' : '거주 취약성 우세형';
    const components = [
      ['거주 기후노출', x.climateRes], ['거주 민감도', x.sensitivityRes], ['거주 대응부족', x.responseRes],
      ['활동 기후노출', x.climateAct], ['활동 민감도', x.sensitivityAct], ['활동 대응부족', x.responseAct]
    ].filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    return `${type}이며, 평균 구성요소 중 ${components[0]?.[0] || '주요 지표'}가 상대적으로 높습니다.`;
  }
  function policyDirection(x) {
    const components = [
      ['기후노출 저감', Math.max(Number(x.climateRes) || 0, Number(x.climateAct) || 0), '열환경 개선과 고온공간 저감시설을 우선 검토합니다.'],
      ['민감집단·활동수요 대응', Math.max(Number(x.sensitivityRes) || 0, Number(x.sensitivityAct) || 0), '취약인구와 활동인구가 집중되는 시간·공간을 중심으로 대책을 배치합니다.'],
      ['대응시설 공백 보완', Math.max(Number(x.responseRes) || 0, Number(x.responseAct) || 0), '쉼터 접근성, 그늘막, 쿨링포그와 정류장 차양의 공백을 우선 보완합니다.']
    ].sort((a,b) => b[1] - a[1]);
    const balance = x.indexGap >= 2 ? '보행·활동공간 중심' : x.indexGap <= -2 ? '생활권·거주민 중심' : '거주·활동 복합 대응';
    const urgency = x.riskRank <= 4 || x.joint >= 5 ? '우선관리' : x.riskRank <= 8 ? '중점관찰' : '상시관리';
    return { balance, urgency, theme: components[0][0], action: components[0][2] };
  }
  function renderCompareScatter(chosen) {
    const all = Object.values(baseStats).filter((x) => x.resMean != null && x.actMean != null);
    const valuesX = all.map((x) => Number(x.resMean)), valuesY = all.map((x) => Number(x.actMean));
    const xmin = Math.floor(Math.min(...valuesX) - 2), xmax = Math.ceil(Math.max(...valuesX) + 2);
    const ymin = Math.floor(Math.min(...valuesY) - 2), ymax = Math.ceil(Math.max(...valuesY) + 2);
    const avgX = valuesX.reduce((a,b)=>a+b,0) / valuesX.length, avgY = valuesY.reduce((a,b)=>a+b,0) / valuesY.length;
    const W=620,H=350,L=54,R=18,T=25,B=43;
    const sx=(v)=>L+(Number(v)-xmin)/(xmax-xmin)*(W-L-R), sy=(v)=>H-B-(Number(v)-ymin)/(ymax-ymin)*(H-T-B);
    const ticks=4, selected=new Set(chosen.map((x)=>x.dong));
    let grid='';
    for(let i=0;i<=ticks;i++){
      const xv=xmin+(xmax-xmin)*i/ticks, yv=ymin+(ymax-ymin)*i/ticks;
      grid += `<line class="scatter-grid" x1="${sx(xv)}" y1="${T}" x2="${sx(xv)}" y2="${H-B}"/><text class="scatter-label" x="${sx(xv)}" y="${H-20}" text-anchor="middle">${num(xv)}</text>`;
      grid += `<line class="scatter-grid" x1="${L}" y1="${sy(yv)}" x2="${W-R}" y2="${sy(yv)}"/><text class="scatter-label" x="${L-8}" y="${sy(yv)+3}" text-anchor="end">${num(yv)}</text>`;
    }
    const points=all.map((x)=>{
      const on=selected.has(x.dong), px=sx(x.resMean), py=sy(x.actMean);
      return `<g><circle class="scatter-dot ${on?'selected':'all'}" cx="${px}" cy="${py}" r="${on?7:4}"><title>${x.dong}: 거주 ${num(x.resMean)}점, 활동 ${num(x.actMean)}점</title></circle>${on?`<text class="scatter-name" x="${px+9}" y="${py-7}">${x.dong}</text>`:''}</g>`;
    }).join('');
    document.getElementById('compareScatter').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="행정동별 거주 및 활동 취약지수 평균 산점도">${grid}<line class="scatter-average" x1="${sx(avgX)}" y1="${T}" x2="${sx(avgX)}" y2="${H-B}"/><line class="scatter-average" x1="${L}" y1="${sy(avgY)}" x2="${W-R}" y2="${sy(avgY)}"/><text class="scatter-quadrant" x="${W-R-5}" y="${T+15}" text-anchor="end">두 지수 모두 높음</text><text class="scatter-quadrant" x="${L+5}" y="${T+15}">활동 노출 우세</text><text class="scatter-quadrant" x="${W-R-5}" y="${H-B-8}" text-anchor="end">거주 취약 우세</text>${points}<line class="scatter-axis" x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}"/><line class="scatter-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H-B}"/><text class="scatter-label" x="${(L+W-R)/2}" y="${H-4}" text-anchor="middle">취약계층 밀집형 평균점수</text><text class="scatter-label" x="14" y="${(T+H-B)/2}" transform="rotate(-90 14 ${(T+H-B)/2})" text-anchor="middle">보행 노출 위험형 평균점수</text></svg>`;
  }
  function renderPolicyDirections(chosen) {
    document.getElementById('comparePolicyDirection').innerHTML = chosen.map((x)=>{
      const d=policyDirection(x);
      return `<article class="policy-direction-card"><span class="priority-tag">${d.urgency}</span><h4>${x.dong}</h4><b>${d.balance} · ${d.theme}</b><p>${d.action} 관리대상은 공통격자의 ${num(x.riskRate)}%이며 종합취약 격자는 ${num(x.joint,0)}개입니다.</p></article>`;
    }).join('');
  }

  function diagnosisMixHTML(x) {
    const parts = [
      ['종합취약', x.joint, APP_CONFIG.diagnosisColors['종합취약지역']],
      ['우선확대', x.priority, APP_CONFIG.diagnosisColors['우선확대관리지역']],
      ['거주 단독', x.resOnly, APP_CONFIG.diagnosisColors['거주 단독 5등급']],
      ['활동 단독', x.actOnly, APP_CONFIG.diagnosisColors['활동 단독 5등급']]
    ];
    const total = Math.max(1, parts.reduce((a, x) => a + x[1], 0));
    return `<div class="diagnosis-mix-row"><div class="diagnosis-mix-head"><b>${x.dong}</b><span>관리대상 ${num(x.riskCount,0)}개 · 공통격자의 ${num(x.riskRate)}%</span></div><div class="diagnosis-stack">${parts.map(([label,v,color]) => `<i style="width:${v/total*100}%;background:${color}" title="${label} ${v}개"></i>`).join('')}</div><div class="diagnosis-mix-legend">${parts.map(([label,v,color]) => `<span><i style="background:${color}"></i>${label} ${num(v,0)}</span>`).join('')}</div></div>`;
  }
  function renderAllDongRank() {
    const key = document.getElementById('compareRankMetric').value;
    const meta = {
      combinedMean: ['공통격자 평균', '점'], resMean: ['거주 평균', '점'], actMean: ['활동 평균', '점'],
      riskRate: ['관리대상 비율', '%'], joint: ['종합취약 격자', '개']
    }[key];
    const rows = Object.values(baseStats).sort((a,b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
    const max = Math.max(...rows.map((x) => Number(x[key]) || 0), 1);
    const el = document.getElementById('compareAllRank');
    el.innerHTML = rows.map((x,i) => `<button class="all-rank-row" data-dong="${x.dong}"><strong>${i+1}</strong><span>${x.dong}</span><div><i style="width:${(Number(x[key])||0)/max*100}%"></i></div><b>${num(x[key])}${meta[1]}</b></button>`).join('');
    el.querySelectorAll('button').forEach((b) => { b.onclick = () => { const empty = compareSelects.find((s) => !s.value) || compareSelects[0]; empty.value = b.dataset.dong; renderCompare(); }; });
  }
  function renderCompare() {
    const chosen = [...new Set(compareSelects.map((x) => x.value).filter(Boolean))].map((d) => baseStats[d]);
    const headline = document.getElementById('compareHeadline');
    if (!chosen.length) {
      headline.innerHTML = '<div class="empty-state">비교할 행정동을 선택하면 점수·등급비율·교차취약 현황이 표시됩니다.</div>';
      ['compareBody','compareScatter','comparePolicyDirection','compareScoreBars','compareGradeBars','compareDiagnosisMix','compareProfiles','compareHeatmap','compareTable','compareInsight'].forEach((id) => { document.getElementById(id).innerHTML = ''; });
      renderAllDongRank();
      return;
    }
    const highest = [...chosen].sort((a, b) => (b.combinedMean ?? 0) - (a.combinedMean ?? 0))[0];
    const mostJoint = [...chosen].sort((a, b) => b.joint - a.joint)[0];
    const mostRisk = [...chosen].sort((a,b) => b.riskRate - a.riskRate)[0];
    const widestGap = [...chosen].sort((a,b) => Math.abs(b.indexGap) - Math.abs(a.indexGap))[0];
    headline.innerHTML = `<div class="compare-summary-chip"><span>공통격자 평균 최고</span><b>${highest.dong} ${num(highest.combinedMean)}점</b></div><div class="compare-summary-chip"><span>종합취약 격자 최다</span><b>${mostJoint.dong} ${num(mostJoint.joint,0)}개</b></div><div class="compare-summary-chip"><span>관리대상 비율 최고</span><b>${mostRisk.dong} ${num(mostRisk.riskRate)}%</b></div><div class="compare-summary-chip"><span>두 지수 격차 최대</span><b>${widestGap.dong} ${num(Math.abs(widestGap.indexGap))}점</b></div>`;
    renderCompareScatter(chosen);
    renderPolicyDirections(chosen);
    document.getElementById('compareBody').innerHTML = chosen.map((x) => `<article class="card compare-card"><div class="compare-card-head"><div><h3>${x.dong}</h3><span>공통격자 평균 ${num(x.combinedMean)}점 · 13개 동 중 ${x.combinedRank}위</span></div><strong>${num(x.joint,0)}</strong></div><div class="compare-card-kpis"><div><span>거주 평균</span><b>${num(x.resMean)}</b><small>${x.resRank}위</small></div><div><span>활동 평균</span><b>${num(x.actMean)}</b><small>${x.actRank}위</small></div><div><span>관리대상</span><b>${num(x.riskCount,0)}</b><small>${num(x.riskRate)}%</small></div><div><span>우선확대</span><b>${num(x.priority,0)}</b><small>개</small></div></div>${compareBar('거주 4·5등급', x.res45Rate, APP_CONFIG.gradeColors[5], '%')}${compareBar('활동 4·5등급', x.act45Rate, APP_CONFIG.gradeColors[1], '%')}<p>${dongInterpret(x)}</p><button class="compare-map-link" data-dong="${x.dong}">통합지도에서 보기</button></article>`).join('');
    document.querySelectorAll('.compare-map-link').forEach((b) => { b.onclick = () => { openTab('map'); document.getElementById('dongSelect').value = b.dataset.dong; YMaps.setDong(b.dataset.dong); }; });
    document.getElementById('compareScoreBars').innerHTML = chosen.map((x) => `<div class="compare-chart-group"><b>${x.dong}</b>${compareBar('취약계층 밀집형', x.resMean, APP_CONFIG.gradeColors[5])}${compareBar('보행 노출 위험형', x.actMean, APP_CONFIG.gradeColors[1])}</div>`).join('');
    document.getElementById('compareGradeBars').innerHTML = chosen.map((x) => `<div class="compare-chart-group"><b>${x.dong}</b>${compareBar('거주 4·5등급', x.res45Rate, APP_CONFIG.gradeColors[5], '%')}${compareBar('활동 4·5등급', x.act45Rate, APP_CONFIG.gradeColors[1], '%')}</div>`).join('');
    document.getElementById('compareDiagnosisMix').innerHTML = chosen.map(diagnosisMixHTML).join('');
    const components = [
      ['거주 기후', 'climateRes'], ['거주 민감도', 'sensitivityRes'], ['거주 대응부족', 'responseRes'],
      ['활동 기후', 'climateAct'], ['활동 민감도', 'sensitivityAct'], ['활동 대응부족', 'responseAct']
    ];
    document.getElementById('compareProfiles').innerHTML = chosen.map((x) => `<div class="profile-column"><h4>${x.dong}</h4>${components.map(([label,key]) => compareBar(label, x[key], APP_CONFIG.scoreColors[Math.min(4, Math.floor((Number(x[key])||0)/20))])).join('')}</div>`).join('');
    document.getElementById('compareHeatmap').innerHTML = `<table class="component-heatmap"><thead><tr><th>구성요소</th>${chosen.map((x) => `<th>${x.dong}</th>`).join('')}</tr></thead><tbody>${components.map(([label,key]) => `<tr><th>${label}</th>${chosen.map((x) => { const v=Number(x[key])||0; const c=APP_CONFIG.scoreColors[Math.min(4,Math.floor(v/20))]; return `<td style="background:${c}"><b>${num(v)}</b></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    document.getElementById('compareTable').innerHTML = '<thead><tr><th>행정동</th><th>거주 평균</th><th>활동 평균</th><th>지수 차이</th><th>거주 4·5등급</th><th>활동 4·5등급</th><th>5·5</th><th>우선확대</th><th>관리대상 비율</th><th>공통격자 평균</th></tr></thead><tbody>' + chosen.map((x) => `<tr><th>${x.dong}</th><td>${num(x.resMean)}점<br><small>${x.resRank}위</small></td><td>${num(x.actMean)}점<br><small>${x.actRank}위</small></td><td>${x.indexGap>=0?'+':''}${num(x.indexGap)}점<br><small>${x.indexGap>0?'활동 우세':x.indexGap<0?'거주 우세':'균형'}</small></td><td>${num(x.res45,0)}개<br><small>${num(x.res45Rate)}%</small></td><td>${num(x.act45,0)}개<br><small>${num(x.act45Rate)}%</small></td><td>${num(x.joint,0)}개</td><td>${num(x.priority,0)}개</td><td>${num(x.riskRate)}%<br><small>${x.riskRank}위</small></td><td>${num(x.combinedMean)}점<br><small>${x.combinedRank}위</small></td></tr>`).join('') + '</tbody>';
    const activityLed = chosen.filter((x) => x.indexGap >= 2).map((x) => x.dong);
    const residentialLed = chosen.filter((x) => x.indexGap <= -2).map((x) => x.dong);
    const topComponent = components.map(([label,key]) => [label, Math.max(...chosen.map((x) => Number(x[key])||0))]).sort((a,b)=>b[1]-a[1])[0];
    const insight = [];
    if (activityLed.length) insight.push(`${activityLed.join('·')}은 보행 노출 위험형 평균이 거주형보다 높아 활동공간 저감시설의 우선 검토가 필요합니다.`);
    if (residentialLed.length) insight.push(`${residentialLed.join('·')}은 취약계층 밀집형 평균이 상대적으로 높아 생활권 쉼터 접근성과 수용여력 개선이 중요합니다.`);
    insight.push(`${mostRisk.dong}은 선택 지역 중 관리대상 교차유형 격자 비율이 가장 높습니다.`);
    insight.push(`선택 지역에서 가장 높은 구성요소 최대값은 ${topComponent[0]} ${num(topComponent[1])}점입니다.`);
    document.getElementById('compareInsight').innerHTML = `<h3>비교 해석</h3><ul>${insight.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    renderAllDongRank();
  }
  renderCompare();
  }

  function rank(kind) {
    const feats = kind === 'residential' ? data.residential.features : kind === 'activity' ? data.activity.features : data.diagnosis.features;
    const rows = feats.map((f) => f.properties).sort((a, b) => (kind === 'diagnosis' ? b.combined_score - a.combined_score : b.score - a.score)).slice(0, 200);
    document.getElementById('rankTable').innerHTML = '<thead><tr><th>순위</th><th>격자</th><th>행정동</th><th>점수</th><th>등급/진단</th></tr></thead><tbody>' + rows.map((p, i) => `<tr><td>${i + 1}</td><td>${p.grid_id}</td><td>${p.dong || p.dong_res}</td><td>${Number(p.score ?? p.combined_score).toFixed(2)}</td><td>${p.grade ?? p.diagnosis}</td></tr>`).join('') + '</tbody>';
    [...document.querySelectorAll('#rankTable tbody tr')].forEach((tr, i) => { tr.onclick = async () => { await openTab('map'); await selectMetric(kind); YMaps.searchGrid(rows[i].grid_id); }; });
  }
  async function showRank(kind) {
    const keys = kind === 'residential' ? [] : [kind];
    return prepare(keys, '순위 자료를 불러오는 중입니다.', () => rank(kind), () => showRank(kind));
  }
  document.getElementById('rankType').onchange = (e) => showRank(e.target.value);
  rank('residential');

  async function openTab(v) {
    const currentView = document.querySelector('.view.on')?.id.replace(/^v-/, '');
    if (currentView && currentView !== v) {
      window.YPanorama?.close({ restoreFocus: false });
    }
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.view === v;
      t.classList.toggle('on', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
    let ready = true;
    if (v === 'compare') {
      ready = await prepare(['activity', 'diagnosis'], '지역 비교 자료를 불러오는 중입니다.', initCompare, () => openTab(v));
    }
    if (v === 'policy') {
      ready = await prepare(['policy', 'roadHeat'], '정책지원 지도를 불러오는 중입니다.', () => YMaps.ensurePolicy(), () => openTab(v));
    }
    if (v === 'lst') {
      ready = await prepare(['lst'], '고해상도 지표면온도를 불러오는 중입니다.', () => YMaps.ensureLST(), () => openTab(v));
    }
    if (!ready) return false;
    if (v === 'map') YMaps.invalidate('main');
    if (v === 'policy') YMaps.invalidate('policy');
    if (v === 'lst') YMaps.invalidate('lst');
    return true;
  }
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => openTab(t.dataset.view); });
  function bindMobileSidebar(buttonId, sidebarId) {
    const button = document.getElementById(buttonId);
    const sidebar = document.getElementById(sidebarId);
    const closeButton = sidebar?.querySelector('.sidebar-close');
    if (!button || !sidebar || !closeButton) return;
    const setOpen = (open) => {
      sidebar.classList.toggle('open', open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.onclick = () => setOpen(!sidebar.classList.contains('open'));
    closeButton.onclick = () => {
      setOpen(false);
      button.focus();
    };
    sidebar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.focus();
      }
    });
  }
  bindMobileSidebar('mobileFilter', 'mainSidebar');
  bindMobileSidebar('policyMobileFilter', 'policySidebar');
  bindMobileSidebar('lstMobileFilter', 'lstSidebar');
  openTab('map');
})();
