window.YMaps = (() => {
  let app = null;
  const C = () => APP_CONFIG;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const n = (v, d = 1) => v == null || Number.isNaN(Number(v))
    ? '-'
    : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const row = (label, v, unit = '', d = 1) =>
    `<div class="metricrow"><span>${label}</span><b>${n(v, d)}${v == null ? '' : unit}</b></div>`;
  const bar = (label, v, pct) => {
    const w = Math.max(0, Math.min(100, Number(v) || 0));
    return `<div class="metricbar"><div class="metricbar-head"><span>${label}</span><b>${n(v)}점${pct == null ? '' : ` · 상위 ${n(100 - pct, 1)}%`}</b></div><div class="metricbar-track"><div class="metricbar-fill" style="width:${w}%"></div></div></div>`;
  };
  const valueBar = (label, v, min, max, unit = '', d = 1) => {
    if (v == null || Number.isNaN(Number(v))) return row(label, null, unit, d);
    const num = Number(v);
    const w = Math.max(0, Math.min(100, ((num - min) / (max - min)) * 100));
    return `<div class="metricbar"><div class="metricbar-head"><span>${label}</span><b>${n(num, d)}${unit}</b></div><div class="metricbar-track"><div class="metricbar-fill" style="width:${w}%"></div></div></div>`;
  };
  const scoreColor = (v) => C().scoreColors[Math.min(4, Math.max(0, Math.floor((Number(v) || 0) / 20)))];
  const gradeColor = (g) => C().gradeColors[Math.round(Number(g))] || '#aaa';
  const roadGradeColor = (g) => (C().roadGradeColors || C().gradeColors)[Math.round(Number(g))] || '#777';
  const lstColors = () => C().lstColors || ['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c'];
  const sprinklerRouteColor = (rank) => Number(rank) <= 3 ? '#7f1d1d' : (Number(rank) <= 6 ? '#b45309' : '#7c3aed');

  let boundaryFeatures = [], outlineFC, maskFC, bounds;
  function prepareBoundary() {
    boundaryFeatures = app.data.boundary.features;
    outlineFC = { type: 'FeatureCollection', features: boundaryFeatures.filter((f) => f.properties.kind !== 'outside_mask') };
    maskFC = { type: 'FeatureCollection', features: boundaryFeatures.filter((f) => f.properties.kind === 'outside_mask') };
    bounds = L.geoJSON(outlineFC).getBounds();
  }
  function addBoundary(map) {
    L.geoJSON(maskFC, { style: { fillColor: '#777', fillOpacity: .9, stroke: false }, interactive: false }).addTo(map);
    return L.geoJSON(outlineFC, {
      style: { color: '#44545d', weight: 1.25, fillOpacity: 0 },
      onEachFeature: (f, l) => l.bindTooltip(f.properties.dong)
    }).addTo(map);
  }

  function minimalGridPopup(p) {
    return `<div class="popup-mini"><b>${esc(p.grid_id)}</b><br>${esc(p.dong || p.dong_res || '-')}</div>`;
  }
  function detailBase(p, type) {
    if (type === 'diagnosis') {
      return `<h3>${esc(p.grid_id)}</h3><div class="note">${esc(p.dong_res)} · ${esc(p.diagnosis)}</div>${bar('취약계층 밀집형', p.score_res, p.percentile_res)}${bar('보행 노출 위험형', p.score_act, p.percentile_act)}${row('거주 등급', p.grade_res, '등급', 0)}${row('활동 등급', p.grade_act, '등급', 0)}${row('평균 종합점수', p.combined_score, '점')}`;
    }
    return `<h3>${esc(p.grid_id)}</h3><div class="note">${esc(p.dong || '-')}</div>${bar('최종 점수', p.score, p.percentile)}${bar('기후노출도', p.climate, p.climate_percentile)}${bar(type === 'residential' ? '거주 기반 민감도' : '활동 기반 민감도', p.sensitivity, p.sensitivity_percentile)}${bar('대응능력 부족도', p.response_lack, p.response_percentile)}${row('공식 등급', p.grade, '등급', 0)}`;
  }
  function sourceBadge(p, key) {
    const sources = {
      climate: p.climate_detail_source || p.lst_detail_source,
      population: p.population_detail_source,
      resi_response: p.resi_response_detail_source,
      act_sensitivity: p.activity_sensitivity_detail_source || p.candidate_detail_source,
      act_response: p.activity_response_detail_source
    };
    const s = sources[key];
    return s ? `<span class="source-badge">${esc(s)}</span>` : '';
  }
  function metricSection(p, metric) {
    if (metric === 'climate') {
      return `<div class="detail-section"><h4>실제 기후 관측값</h4>${row('평균 지표면온도', p.LST_mean_all, '℃')}${row('중앙 지표면온도', p.LST_median_all, '℃')}${row('상위 10% 지표면온도', p.LST_top10_mean, '℃')}${row('최고 지표면온도', p.LST_max, '℃')}${row('33℃ 이상 관측비율', p.LST_33_ratio == null ? null : Number(p.LST_33_ratio) * 100, '%')}${row('일최고 기온·체감온도 평균', p.daily_max_ta_chi_mean, '℃')}${row('상위 10일 기온·체감온도', p.daily_max_ta_chi_top10_mean, '℃')}${row('KMA 매칭거리', p.KMA_nearest_dist_m, 'm', 0)}${sourceBadge(p, 'climate')}${p.daily_max_ta_chi_mean == null ? '<div class="note">KMA 원시값이 없는 격자는 점수만 표시합니다.</div>' : ''}</div>`;
    }
    if (metric === 'resi_response') {
      const items = (p.shelters || []).map((s) => `<div class="facility-item"><b>${esc(s.name)}</b>${esc(s.type || '')} · 수용 ${n(s.capacity, 0)}명<br>${esc(s.address || '')}${s.weekday ? `<br>평일 ${esc(s.weekday)}` : ''}</div>`).join('');
      return `<div class="detail-section"><h4>격자 내 무더위쉼터</h4>${row('격자 내 쉼터 수', p.shelter_count_in_grid_all ?? p.shelter_count_grid, '개', 0)}${row('격자 내 수용인원', p.shelter_capacity_in_grid_all ?? p.shelter_capacity_grid, '명', 0)}${row('500m 내 쉼터 수', p.shelter_count_500m_all, '개', 0)}${row('500m 내 수용인원', p.shelter_capacity_500m_all, '명', 0)}${row('가장 가까운 쉼터', p.nearest_shelter_dist_m_all, 'm', 0)}${items || '<div class="note">격자 내부에 등록된 무더위쉼터가 없습니다.</div>'}${sourceBadge(p, 'resi_response')}</div>`;
    }
    if (metric === 'act_sensitivity') {
      return `<div class="detail-section"><h4>유동·활동인구 정보</h4>${row('시간가중 활동인구 평균', p.activity_pop_time_weighted_mean, '명')}${row('12~17시 시간당 평균', p.activity_pop_12_17_avg_mean, '명')}${row('첨두시간 활동인구 평균', p.activity_pop_peak_mean, '명')}${row('전 시간 활동인구 평균', p.activity_pop_avg_all_hours_mean, '명')}${row('전 시간 총인구 평균', p.total_pop_avg_all_hours_mean, '명')}${row('직장인구 평균', p.work_pop_avg_all_hours_mean, '명')}${row('방문인구 평균', p.visitor_pop_avg_all_hours_mean, '명')}${row('주거인구 평균', p.home_pop_avg_all_hours_mean, '명')}${row('성·연령 민감도 점수', p.sexage_score, '점')}${row('시간활동 점수', p.time_score, '점')}${row('버스 이용량 점수', p.bus_usage_score, '점')}${sourceBadge(p, 'act_sensitivity')}${p.activity_pop_time_weighted_mean == null ? '<div class="note">원시 유동인구가 미탑재된 격자는 구성 점수만 표시합니다.</div>' : ''}</div>`;
    }
    if (metric === 'act_response') {
      return `<div class="detail-section"><h4>폭염저감시설 현황</h4>${row('격자 내 그늘막', p.shade_count_grid, '개', 0)}${row('300m 내 그늘막', p.shade_count_300m, '개', 0)}${row('가장 가까운 그늘막', p.shade_nearest_distance_m, 'm', 0)}${row('격자 내 쿨링포그', p.fog_count_grid ?? (p.fog_presence ? 1 : 0), '개', 0)}${row('가장 가까운 쿨링포그', p.fog_nearest_distance_m, 'm', 0)}${row('격자 내 버스정류장', p.bus_stop_count, '개', 0)}${row('차양 정류장', p.bus_stop_shaded_count, '개', 0)}${row('무차양 정류장', p.bus_stop_unshaded_count, '개', 0)}${(p.shade_names || []).length ? `<div class="note">그늘막: ${esc(p.shade_names.join(', '))}</div>` : ''}${(p.fog_site_names || []).length ? `<div class="note">쿨링포그: ${esc(p.fog_site_names.join(', '))}</div>` : ''}${sourceBadge(p, 'act_response')}</div>`;
    }
    if (metric === 'resi_sensitivity') {
      return `<div class="detail-section"><h4>거주 기반 참고정보</h4>${row('총인구', p.total_population ?? p.총인구_남녀합, '명', 0)}${row('60대 이상 인구', p['60대이상인구_계'], '명', 0)}${row('70대 이상 인구', p['70대이상인구_계'], '명', 0)}${row('80대 이상 인구', p['80대이상인구_계'], '명', 0)}${row('유소년 인구', p['유소년인구_계'], '명', 0)}<div class="note">사회경제적 취약계층 세부 값과 인원은 공개하지 않습니다.</div>${sourceBadge(p, 'population')}</div>`;
    }
    return '';
  }
  function renderGridDetail(p, type, metric) {
    const el = document.getElementById('gridDetail');
    el.innerHTML = detailBase(p, type) + metricSection(p, metric);
    el.classList.add('on');
  }

  let mainMap, mainGridLayer, mainOutline, mainDongMask, mainSelected;
  let currentMetric = 'residential', gradeFilter = 'all', selectedDong = '';
  let selectedGridId = null;
  let baseLayers = {};
  function initMain() {
    mainMap = L.map('mainMap', { preferCanvas: true, zoomControl: true, zoomSnap: .25 }).setView(C().center, C().zoom);
    baseLayers.carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '© OpenStreetMap © CARTO' }).addTo(mainMap);
    baseLayers.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'soft-osm-tiles' });
    mainOutline = addBoundary(mainMap);
    renderMain();
  }
  function clearMainDongMask() {
    if (mainDongMask && mainMap.hasLayer(mainDongMask)) mainMap.removeLayer(mainDongMask);
    mainDongMask = null;
  }
  function renderMainDongMask() {
    clearMainDongMask();
    if (!selectedDong) {
      if (mainOutline?.bringToFront) mainOutline.bringToFront();
      return;
    }
    const masked = {
      type: 'FeatureCollection',
      features: outlineFC.features.filter((f) => f.properties.dong && f.properties.dong !== selectedDong)
    };
    mainDongMask = L.geoJSON(masked, {
      style: {
        fillColor: '#70777b',
        fillOpacity: .76,
        color: '#59636a',
        weight: .45,
        opacity: .28
      },
      interactive: false
    }).addTo(mainMap);
    if (mainOutline?.bringToFront) mainOutline.bringToFront();
  }
  function datasetFor(metric) {
    if (metric === 'off') return ['off', { features: [] }];
    if (['residential', 'resi_sensitivity', 'resi_response'].includes(metric)) return ['residential', app.data.residential];
    if (['activity', 'climate', 'act_sensitivity', 'act_response'].includes(metric)) return ['activity', app.data.activity];
    return ['diagnosis', app.data.diagnosis];
  }
  function valFor(p, m) {
    return m === 'residential' || m === 'activity' ? p.score
      : m === 'climate' ? p.climate
      : m === 'resi_sensitivity' || m === 'act_sensitivity' ? p.sensitivity
      : m === 'resi_response' || m === 'act_response' ? p.response_lack
      : p.combined_score;
  }
  function resetMainHighlight() {
    if (mainSelected && mainGridLayer) {
      try { mainGridLayer.resetStyle(mainSelected); } catch (_) { /* no-op */ }
    }
    mainSelected = null;
  }
  function highlightMainLayer(layer) {
    resetMainHighlight();
    mainSelected = layer;
    layer.setStyle({ color: '#24323a', weight: 4, opacity: 1, fillOpacity: .7, dashArray: '6 3' });
    if (layer.bringToFront) layer.bringToFront();
  }
  function selectedFeatureInCurrentLayer() {
    if (!selectedGridId || currentMetric === 'off') return null;
    const [type, fc] = datasetFor(currentMetric);
    const feature = fc.features.find((f) => f.properties.grid_id === selectedGridId);
    return feature ? { type, feature } : null;
  }
  function restoreSelectedGrid(openPopup = false) {
    if (!selectedGridId || !mainGridLayer || currentMetric === 'off') return false;
    const found = selectedFeatureInCurrentLayer();
    if (!found) {
      const el = document.getElementById('gridDetail');
      el.innerHTML = `<h3>${esc(selectedGridId)}</h3><div class="note">선택한 격자는 현재 표시 지표의 분석대상에 포함되지 않습니다.</div>`;
      el.classList.add('on');
      return false;
    }
    renderGridDetail(found.feature.properties, found.type, currentMetric);
    let layer = null;
    mainGridLayer.eachLayer((l) => { if (l.feature?.properties?.grid_id === selectedGridId) layer = l; });
    if (!layer) {
      mainMap.closePopup();
      return false;
    }
    highlightMainLayer(layer);
    if (openPopup) {
      L.popup().setLatLng(layer.getBounds().getCenter()).setContent(minimalGridPopup(found.feature.properties)).openOn(mainMap);
    }
    return true;
  }
  function renderMain() {
    if (mainGridLayer) {
      mainMap.removeLayer(mainGridLayer);
      mainGridLayer = null;
    }
    mainSelected = null;
    const [type, fc] = datasetFor(currentMetric);
    if (type === 'off') {
      document.getElementById('mainLegend').innerHTML = '<b>표시 지표 꺼짐</b>';
      document.getElementById('mainLegend').classList.add('off');
      document.getElementById('mapStatus').textContent = '배경지도와 행정동 경계만 표시';
      mainMap.closePopup();
      document.getElementById('gridDetail').classList.remove('on');
      renderMainDongMask();
      return;
    }
    document.getElementById('mainLegend').classList.remove('off');
    const filtered = {
      type: 'FeatureCollection',
      features: fc.features.filter((f) => {
        const p = f.properties;
        if (type === 'diagnosis' && p.diagnosis === '기타 교차지역') return false;
        const g = type === 'diagnosis' ? p.combined_grade : p.grade;
        return gradeFilter === 'all' || (gradeFilter === '45' && g >= 4) || (gradeFilter === '5' && g === 5);
      })
    };
    mainGridLayer = L.geoJSON(filtered, {
      renderer: L.canvas({ padding: .4 }),
      style: (f) => {
        const p = f.properties;
        const dong = p.dong || p.dong_res;
        const inside = !selectedDong || dong === selectedDong;
        const color = currentMetric === 'diagnosis'
          ? C().diagnosisColors[p.diagnosis]
          : (['residential', 'activity'].includes(currentMetric) ? gradeColor(p.grade) : scoreColor(valFor(p, currentMetric)));
        return { fillColor: color, color: inside ? '#687e88' : '#9aa3a7', weight: inside ? .38 : .12, opacity: inside ? .58 : .06, fillOpacity: inside ? .64 : .035 };
      },
      onEachFeature: (f, l) => {
        l.on('click', (e) => selectMain(l, f, e.latlng, type));
        l.bindTooltip(`${esc(f.properties.grid_id)} · ${esc(f.properties.dong || f.properties.dong_res)}`);
      }
    }).addTo(mainMap);
    renderMainDongMask();
    renderMainLegend(type);
    document.getElementById('mapStatus').textContent = `${filtered.features.length.toLocaleString()}개 격자 표시${selectedDong ? ' · ' + selectedDong : ''}`;
    restoreSelectedGrid(false);
  }
  function selectMain(layer, f, ll, type) {
    selectedGridId = f.properties.grid_id;
    highlightMainLayer(layer);
    if (layer.bringToFront) layer.bringToFront();
    L.popup().setLatLng(ll || layer.getBounds().getCenter()).setContent(minimalGridPopup(f.properties)).openOn(mainMap);
    renderGridDetail(f.properties, type, currentMetric);
  }
  function setMetric(m) {
    currentMetric = m;
    const s = document.getElementById('metricSelect');
    if (s) s.value = m;
    renderMain();
  }
  function setGrade(g) {
    gradeFilter = g;
    document.querySelectorAll('#gradeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.grade === g));
    renderMain();
  }
  function setDong(d) {
    selectedDong = d;
    renderMain();
    if (d) {
      const feat = outlineFC.features.find((f) => f.properties.dong === d);
      if (feat) mainMap.fitBounds(L.geoJSON(feat).getBounds(), { padding: [18, 18] });
    } else mainMap.fitBounds(bounds, { padding: [18, 18] });
  }
  function setBase(b) {
    Object.values(baseLayers).forEach((l) => mainMap.removeLayer(l));
    baseLayers[b].addTo(mainMap);
    baseLayers[b].bringToBack();
  }
  function searchGrid(gid) {
    gid = String(gid || '').trim();
    if (!gid) return false;
    if (currentMetric === 'off') setMetric('residential');
    let [type, fc] = datasetFor(currentMetric);
    let feat = fc.features.find((f) => f.properties.grid_id === gid);
    if (!feat) {
      const candidates = [
        ['residential', 'residential', app.data.residential],
        ['activity', 'activity', app.data.activity],
        ['diagnosis', 'diagnosis', app.data.diagnosis]
      ];
      const hit = candidates.find(([, , data]) => data.features.some((f) => f.properties.grid_id === gid));
      if (!hit) return false;
      setMetric(hit[0]);
      [type, fc] = datasetFor(currentMetric);
      feat = fc.features.find((f) => f.properties.grid_id === gid);
    }
    selectedGridId = gid;
    selectedDong = '';
    document.getElementById('dongSelect').value = '';
    renderMain();
    let foundLayer = null;
    mainGridLayer?.eachLayer((l) => { if (l.feature.properties.grid_id === gid) foundLayer = l; });
    if (foundLayer) {
      mainMap.fitBounds(foundLayer.getBounds(), { maxZoom: 17, padding: [80, 80] });
      selectMain(foundLayer, foundLayer.feature, foundLayer.getBounds().getCenter(), type);
    }
    return !!foundLayer;
  }
  function renderMainLegend(type) {
    const el = document.getElementById('mainLegend');
    if (type === 'diagnosis') {
      el.innerHTML = '<b>교차진단</b>' + Object.entries(C().diagnosisColors).map(([k, c]) => `<div class="legend-row"><i class="swatch" style="background:${c}"></i>${k}</div>`).join('');
    } else if (['residential', 'activity'].includes(currentMetric)) {
      el.innerHTML = '<b>공식 5등급</b>' + [1, 2, 3, 4, 5].map((g) => `<div class="legend-row"><i class="swatch" style="background:${gradeColor(g)}"></i>${g}등급</div>`).join('');
    } else {
      el.innerHTML = '<b>점수 구간</b>' + C().scoreColors.map((c, i) => `<div class="legend-row"><i class="swatch" style="background:${c}"></i>${i * 20} ~ ${(i + 1) * 20}점</div>`).join('');
    }
  }

  let policyMap, policyOutline, policyLayer, policyType = '스마트복합쉼터', policySelected, roadSelected;
  let roadGroups = {}, routeGroup, roadRenderer, routeRenderer;
  let roadVisible = { 1: true, 2: true, 3: true, 4: true, 5: true, priority: true };
  function resetPolicySelection(clearPanel = false) {
    policyMap?.closePopup();
    if (policySelected && policyLayer?.resetStyle) {
      try { policyLayer.resetStyle(policySelected); } catch (_) { /* no-op */ }
    }
    if (roadSelected) {
      const g = roadSelected.feature?.properties?.grade;
      roadSelected.setStyle({ color: roadGradeColor(g), weight: 4.8, opacity: .94 });
    }
    policySelected = null;
    roadSelected = null;
    if (clearPanel) {
      const el = document.getElementById('policyDetail');
      el.innerHTML = '';
      el.classList.remove('on');
    }
  }
  function policyDisplayName(p) {
    if (['무차양 버스정류장', '스마트복합쉼터', '쿨링포그', '살수차'].includes(p.policy_type)) return p.name || p.grid_id || '-';
    return p.grid_id || p.name || '-';
  }
  function initPolicy() {
    policyMap = L.map('policyMap', { preferCanvas: true, zoomSnap: .25 }).setView(C().center, C().zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'soft-osm-tiles' }).addTo(policyMap);
    policyOutline = addBoundary(policyMap);
    policyMap.createPane('roadPriorityPane');
    policyMap.getPane('roadPriorityPane').style.zIndex = 470;
    policyMap.getPane('roadPriorityPane').style.pointerEvents = 'none';
    policyMap.createPane('roadHeatPane');
    policyMap.getPane('roadHeatPane').style.zIndex = 460;
    policyMap.getPane('roadHeatPane').style.pointerEvents = 'auto';
    roadRenderer = L.svg({ pane: 'roadHeatPane', padding: .6 });
    routeRenderer = L.svg({ pane: 'roadPriorityPane', padding: .4 });
    function nearestVisibleRoadLayer(latlng, maxPixels = 18) {
      const clickPoint = policyMap.latLngToLayerPoint(latlng);
      let best = null, bestDistance = Infinity;
      const inspectLine = (layer, line) => {
        for (let i = 1; i < line.length; i++) {
          const a = policyMap.latLngToLayerPoint(line[i - 1]);
          const b = policyMap.latLngToLayerPoint(line[i]);
          const distance = L.LineUtil.pointToSegmentDistance(clickPoint, a, b);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = layer;
          }
        }
      };
      const walk = (layer, coords) => {
        if (!Array.isArray(coords) || !coords.length) return;
        if (coords[0] && typeof coords[0].lat === 'number') inspectLine(layer, coords);
        else coords.forEach((part) => walk(layer, part));
      };
      for (let grade = 1; grade <= 5; grade++) {
        if (!roadVisible[grade] || !policyMap.hasLayer(roadGroups[grade])) continue;
        roadGroups[grade].eachLayer((layer) => walk(layer, layer.getLatLngs?.() || []));
      }
      return bestDistance <= maxPixels ? best : null;
    }
    for (let g = 1; g <= 5; g++) {
      const fc = { type: 'FeatureCollection', features: app.data.roadHeat.features.filter((f) => Number(f.properties.grade) === g) };
      roadGroups[g] = L.geoJSON(fc, {
        renderer: roadRenderer,
        pane: 'roadHeatPane',
        interactive: true,
        bubblingMouseEvents: false,
        style: { color: roadGradeColor(g), weight: 4.8, opacity: .94, lineCap: 'round', lineJoin: 'round' },
        onEachFeature: (f, l) => {
          l.bindTooltip(`${esc(f.properties.road_name || '도로')} · ${esc(f.properties.link_id || '-')}`, { sticky: true });
          l.on('add', () => {
            if (l._path) {
              l._path.style.pointerEvents = 'stroke';
              l._path.style.cursor = 'pointer';
            }
          });
          l.on('mouseover', () => { if (l !== roadSelected) l.setStyle({ weight: 7.2, opacity: 1 }); });
          l.on('mouseout', () => { if (l !== roadSelected) l.setStyle({ weight: 4.8, opacity: .94 }); });
          l.on('click', (e) => {
            if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
            selectRoadLink(l, f, e.latlng || l.getBounds().getCenter());
          });
        }
      });
    }
    policyMap.on('click', (e) => {
      if (policyType !== '살수차') return;
      const layer = nearestVisibleRoadLayer(e.latlng, 18);
      if (layer?.feature) selectRoadLink(layer, layer.feature, e.latlng);
    });
    renderPolicy();
  }
  function policyMini(p) {
    return `<div class="popup-mini"><b>${p.rank == null ? '후보' : esc(p.rank) + '순위'}</b><br>${esc(policyDisplayName(p))}</div>`;
  }
  function policyDetailHTML(p) {
    const context = [p.policy_type, p.dong].filter(Boolean).join(' · ');
    const grid = p.grid_id && p.grid_id !== '-' ? row('격자명', p.grid_id) : '';
    const head = `<h3>${esc(policyDisplayName(p))}</h3>${context ? `<div class="note">${esc(context)}</div>` : ''}${row('순위', p.rank, '위', 0)}${p.score != null ? row('우선순위 점수', p.score, '점') : ''}${grid}`;

    if (p.policy_type === '스마트복합쉼터') {
      return head + `<div class="detail-section"><h4>후보 격자 진단</h4>${valueBar('기후노출도', p.climate_exposure, 0, 100, '점')}${valueBar('활동 취약점수', p.activity_score, 0, 100, '점')}${valueBar('활동 백분위', p.activity_percentile, 0, 100, '%')}${row('활동 등급', p.activity_grade, '등급', 0)}${row('거주인구', p.resident_population, '명', 0)}${row('500m 내 총인구', p.population_500m, '명', 0)}${row('500m 내 활동 4·5등급 격자', p.activity_grade45_grids_500m, '개', 0)}</div><div class="detail-section"><h4>핵심 설치 판단</h4><div class="note policy-explain">${esc(p.core_judgment || p.note || '')}</div>${p.site_checks ? `<div class="facility-item"><b>현장 검토사항</b>${esc(p.site_checks)}</div>` : ''}</div>`;
    }

    if (p.policy_type === '그늘막쉼터') {
      const resi = p.resi_nonresidential
        ? '<div class="metricrow"><span>취약계층 밀집형</span><b>비거주 격자</b></div>'
        : `${valueBar('취약계층 밀집형 점수', p.resi_score, 0, 100, '점')}${row('취약계층 밀집형 백분위', p.resi_percentile, '%')}${row('취약계층 밀집형 등급', p.resi_grade, '등급', 0)}`;
      const notes = (p.feature_notes || []).map((x) => `<li>${esc(x)}</li>`).join('');
      return head + `<div class="detail-section"><h4>폭염·보행 지표</h4>${valueBar('보행 노출 위험형 점수', p.activity_score, 0, 100, '점')}${row('보행 노출 위험형 백분위', p.activity_percentile, '%')}${row('보행 노출 위험형 등급', p.activity_grade, '등급', 0)}${valueBar('평균 지표면온도', p.mean_lst, 25, 55, '℃')}${row('평균 LST 백분위', p.mean_lst_percentile, '%')}${valueBar('최고 지표면온도', p.max_lst, 35, 60, '℃')}${row('최고 LST 백분위', p.max_lst_percentile, '%')}${row('평균 일최고체감온도', p.mean_apparent_temp, '℃')}${row('12~17시 시간당 활동인구', p.activity_pop_12_17, '명', 0)}${row('전 시간 시간당 총인구', p.total_pop_all_hours, '명', 0)}${resi}</div><div class="detail-section"><h4>후보지 특징</h4>${notes ? `<ul class="detail-list">${notes}</ul>` : `<div class="note">${esc(p.note || '')}</div>`}</div>`;
    }

    if (p.policy_type === '무차양 버스정류장') {
      const movement = [p.boarding_mean, p.alighting_mean, p.transfer_mean].some((v) => v != null)
        ? `${row('승차', p.boarding_mean, '명', 0)}${row('하차', p.alighting_mean, '명', 0)}${row('환승', p.transfer_mean, '명', 0)}`
        : '<div class="note">승차·하차·환승 세부자료가 확인되지 않은 정류장입니다.</div>';
      return head + `<div class="detail-section"><h4>버스정류장 정보</h4>${row('월평균 버스이용량', p.bus_usage_mean, '명', 0)}${movement}${row('버스이용량 등급', p.bus_usage_grade, '등급', 0)}${row('거주 취약지수', p.resi_score, '점')}${row('거주 백분위', p.resi_percentile, '%')}${row('활동 취약지수', p.activity_score, '점')}${row('활동 백분위', p.activity_percentile, '%')}</div><div class="detail-section"><h4>선정·검토 내용</h4><div class="note">${esc(p.note || '')}</div><div class="note" style="margin-top:7px">${esc(p.detail || '')}</div></div>`;
    }

    if (p.policy_type === '쿨링포그') {
      return head + `<div class="detail-section"><h4>설치 수요·열환경</h4>${valueBar('평균 LST', p.mean_lst, 25, 55, '℃')}${valueBar('상위 10% LST', p.top10_lst, 35, 60, '℃')}${valueBar('실제 최고 LST', p.max_lst, 35, 60, '℃')}${valueBar('시간활동 점수', p.time_activity_score, 0, 100, '점')}${valueBar('고위험 성·연령 점수', p.sexage_score, 0, 100, '점')}${row('300m 내 거주 4·5등급 인구', p.resident_grade45_pop_300m, '명', 0)}${valueBar('보행 노출 위험 백분위', p.activity_percentile, 0, 100, '%')}</div><div class="detail-section"><h4>선정근거</h4><div class="note policy-explain">${esc(p.selection_basis || p.note || '')}</div></div>`;
    }

    return head + `<div class="detail-section"><h4>선정·검토 내용</h4><div class="note">${esc(p.note || '')}</div><div class="note" style="margin-top:7px">${esc(p.detail || '')}</div></div>`;
  }
  function roadLinkDetailHTML(p) {
    const above = p.above33_ratio == null ? null : Number(p.above33_ratio) * 100;
    const fraction = p.mean_road_fraction == null ? null : Number(p.mean_road_fraction) * 100;
    return `<h3>${esc(p.road_name || '도로 링크')}</h3><div class="note">도로 고온 ${n(p.grade, 0)}등급 · 링크 ${esc(p.link_id || '-')}</div>${row('LINK ID', p.link_id)}${row('도로명', p.road_name)}${row('차로 수', p.lanes, '차로', 0)}${row('제한속도', p.max_speed, 'km/h', 0)}${row('링크 길이', p.length_m, 'm', 1)}<div class="detail-section"><h4>도로 온도·노출 지표</h4>${valueBar('평균 LST', p.mean_lst, 20, 60, '℃')}${valueBar('상위 10% LST', p.top10_lst, 20, 60, '℃')}${valueBar('최고 LST', p.max_lst, 20, 60, '℃')}${valueBar('평균 상대고온도', p.mean_anomaly, -15, 10, '℃')}${valueBar('평균 날짜별 백분위', p.mean_percentile, 0, 100, '%')}${valueBar('33℃ 이상 관측 비율', above, 0, 100, '%')}${valueBar('평균 도로면 점유율', fraction, 0, 100, '%')}${valueBar('도로 고온 점수', p.heat_score, 0, 100, '점')}${row('유효 촬영일 수', p.valid_date_count, '일', 0)}${row('고온 5등급', p.grade, '등급', 0)}${row('데이터 품질', p.data_quality)}</div>`;
  }
  function selectPolicyLayer(layer, f, ll) {
    resetPolicySelection(false);
    policySelected = layer;
    if (layer.setStyle) layer.setStyle({ color: '#111', weight: 5, opacity: 1, fillOpacity: .82 });
    L.popup().setLatLng(ll || layer.getBounds?.().getCenter() || layer.getLatLng()).setContent(policyMini(f.properties)).openOn(policyMap);
    const el = document.getElementById('policyDetail');
    el.innerHTML = policyDetailHTML(f.properties);
    el.classList.add('on');
  }
  function selectRoadLink(layer, f, ll) {
    resetPolicySelection(false);
    roadSelected = layer;
    layer.setStyle({ color: '#111', weight: 9.6, opacity: 1 });
    if (layer.bringToFront) layer.bringToFront();
    L.popup().setLatLng(ll).setContent(`<div class="popup-mini"><b>${esc(f.properties.road_name || '도로')}</b><br>${esc(f.properties.link_id || '-')}</div>`).openOn(policyMap);
    const el = document.getElementById('policyDetail');
    el.innerHTML = roadLinkDetailHTML(f.properties);
    el.classList.add('on');
  }
  function policyStyle(f) {
    const type = f.properties.policy_type, c = C().policyColors[type], gt = f.geometry.type;
    if (gt.includes('Line')) {
      const rank = f.properties.rank;
      return { color: sprinklerRouteColor(rank), weight: Number(rank) <= 3 ? 11 : 9, opacity: .96, lineCap: 'round', lineJoin: 'round' };
    }
    return { color: '#5e7079', weight: 1.15, fillColor: c, fillOpacity: .66 };
  }
  function renderPolicy() {
    resetPolicySelection(true);
    if (policyLayer) policyMap.removeLayer(policyLayer);
    Object.values(roadGroups).forEach((l) => policyMap.removeLayer(l));
    if (routeGroup) policyMap.removeLayer(routeGroup);
    const roadBox = document.getElementById('roadLayerControls');
    roadBox.style.display = policyType === '살수차' ? 'block' : 'none';
    const feats = app.data.policy.features.filter((f) => f.properties.policy_type === policyType);
    const fc = { type: 'FeatureCollection', features: feats };
    const policyOptions = {
      renderer: L.canvas({ padding: .4 }),
      style: policyStyle,
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 7, color: '#ffffff', weight: 2, fillColor: C().policyColors[f.properties.policy_type], fillOpacity: .91 }),
      onEachFeature: (f, l) => l.on('click', (e) => selectPolicyLayer(l, f, e.latlng))
    };
    if (policyType === '살수차') {
      policyOptions.renderer = routeRenderer;
      policyOptions.pane = 'roadPriorityPane';
      policyOptions.interactive = false;
      policyOptions.onEachFeature = undefined;
    }
    policyLayer = L.geoJSON(fc, policyOptions);
    if (policyType === '살수차') {
      routeGroup = policyLayer;
      for (let g = 1; g <= 5; g++) if (roadVisible[g]) roadGroups[g].addTo(policyMap);
      if (roadVisible.priority) routeGroup.addTo(policyMap);
    } else {
      routeGroup = null;
      policyLayer.addTo(policyMap);
    }
    renderPolicyList(feats);
    renderPolicyLegend();
    document.getElementById('policyStatus').textContent = `${policyType} · ${feats.length}개 후보`;
  }
  function renderPolicyList(feats) {
    const sorted = [...feats].sort((a, b) => (Number(a.properties.rank) || 999) - (Number(b.properties.rank) || 999));
    const el = document.getElementById('policyList');
    el.innerHTML = sorted.map((f, i) => `<button data-i="${i}"><span class="policy-rank">${f.properties.rank ?? '-'}</span>${esc(policyDisplayName(f.properties))}</button>`).join('');
    [...el.querySelectorAll('button')].forEach((b, i) => { b.onclick = () => focusPolicy(sorted[i]); });
  }
  function focusPolicy(f) {
    let target = null;
    policyLayer?.eachLayer((l) => { if (l.feature === f || l.feature?.properties === f.properties) target = l; });
    if (target) {
      if (target.getBounds) policyMap.fitBounds(target.getBounds(), { maxZoom: 17, padding: [70, 70] });
      else policyMap.setView(target.getLatLng(), 17);
      selectPolicyLayer(target, f, target.getBounds ? target.getBounds().getCenter() : target.getLatLng());
    }
  }
  function renderPolicyLegend() {
    const el = document.getElementById('policyLegend');
    if (policyType === '살수차') {
      el.innerHTML = '<b>살수차 레이어</b>' + [1, 2, 3, 4, 5].filter((g) => roadVisible[g]).map((g) => `<div class="legend-row"><i class="swatch" style="background:${roadGradeColor(g)}"></i>도로 고온 ${g}등급</div>`).join('') + (roadVisible.priority ? `<div class="legend-row"><i class="swatch" style="background:#7f1d1d"></i>우선 운영 1~3위</div><div class="legend-row"><i class="swatch" style="background:#b45309"></i>우선 운영 4~6위</div><div class="legend-row"><i class="swatch" style="background:#7c3aed"></i>우선 운영 7~10위</div>` : '');
    } else {
      el.innerHTML = `<b>${policyType}</b><div class="legend-row"><i class="swatch" style="background:${C().policyColors[policyType]}"></i>정책 후보</div>`;
    }
  }
  function setPolicyType(t) {
    policyType = t;
    resetPolicySelection(true);
    renderPolicy();
  }
  function setRoadLayer(k, on) {
    roadVisible[k === 'priority' ? 'priority' : Number(k)] = on;
    renderPolicy();
  }

  let lstMap, lstOutline, lstCanvas, lstMetric = 'mean', lstVisible = true, lstIndex = {};
  function initLST() {
    lstMap = L.map('lstMap', { preferCanvas: true }).setView(C().center, C().zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'soft-osm-tiles' }).addTo(lstMap);
    lstOutline = addBoundary(lstMap);
    const f = app.data.lst.features[0], coords = f.geometry.coordinates, vals = f.properties.metrics, br = f.properties.breaks;
    const Canvas = L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'lst-canvas leaflet-zoom-hide');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        map.getPanes().overlayPane.appendChild(this._canvas);
        map.on('move zoom resize', this.draw, this);
        this.draw();
      },
      onRemove(map) {
        map.off('move zoom resize', this.draw, this);
        this._canvas.remove();
      },
      draw() {
        if (!this._map || !lstVisible) return;
        const sz = this._map.getSize(), dpr = window.devicePixelRatio || 1, c = this._canvas;
        c.width = sz.x * dpr; c.height = sz.y * dpr; c.style.width = sz.x + 'px'; c.style.height = sz.y + 'px';
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(c, topLeft);
        const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, sz.x, sz.y);
        const size = Math.max(2, Math.min(9, Math.pow(2, this._map.getZoom() - 12) * 1.8));
        const b = br[lstMetric];
        for (let i = 0; i < coords.length; i++) {
          const v = vals[lstMetric][i]; if (v == null) continue;
          const lp = this._map.latLngToLayerPoint([coords[i][1], coords[i][0]]);
          const pt = lp.subtract(topLeft);
          if (pt.x < -size || pt.y < -size || pt.x > sz.x + size || pt.y > sz.y + size) continue;
          let k = 0; while (k < 4 && v > b[k + 1]) k++;
          ctx.fillStyle = lstColors()[k]; ctx.globalAlpha = .82; ctx.fillRect(pt.x - size / 2, pt.y - size / 2, size + 1, size + 1);
        }
      }
    });
    lstCanvas = new Canvas().addTo(lstMap);
    coords.forEach((c, i) => { const k = Math.floor(c[0] * 1000) + '_' + Math.floor(c[1] * 1000); (lstIndex[k] || (lstIndex[k] = [])).push(i); });
    lstMap.on('click', (e) => {
      if (!lstVisible) return;
      let best = -1, bd = 1e9; const x = Math.floor(e.latlng.lng * 1000), y = Math.floor(e.latlng.lat * 1000);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of (lstIndex[(x + dx) + '_' + (y + dy)] || [])) {
        const d = (coords[i][0] - e.latlng.lng) ** 2 + (coords[i][1] - e.latlng.lat) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) L.popup().setLatLng([coords[best][1], coords[best][0]]).setContent(`<b>Landsat 30m 픽셀</b><br>평균 ${n(vals.mean[best])}℃<br>상위10% ${n(vals.p90[best])}℃<br>최고 ${n(vals.max[best])}℃<br>33℃ 이상 ${n(vals.above33[best])}%<br>유효 장면 ${n(vals.scenes[best], 0)}개`).openOn(lstMap);
    });
    updateLSTToggle();
    renderLSTLegend();
  }
  function setLSTMetric(m) {
    if (m === 'off') {
      lstVisible = false;
      if (lstMap.hasLayer(lstCanvas)) lstMap.removeLayer(lstCanvas);
      updateLSTToggle();
      renderLSTLegend();
      return;
    }
    lstMetric = m;
    if (lstVisible && !lstMap.hasLayer(lstCanvas)) lstCanvas.addTo(lstMap);
    if (lstVisible) lstCanvas.draw();
    renderLSTLegend();
  }
  function toggleLST() {
    lstVisible = !lstVisible;
    if (lstVisible) {
      if (!lstMap.hasLayer(lstCanvas)) lstCanvas.addTo(lstMap);
      lstCanvas.draw();
    } else {
      if (lstMap.hasLayer(lstCanvas)) lstMap.removeLayer(lstCanvas);
      lstMap.closePopup();
    }
    updateLSTToggle();
    renderLSTLegend();
    return lstVisible;
  }
  function updateLSTToggle() {
    const btn = document.getElementById('lstToggleBtn');
    if (!btn) return;
    btn.textContent = lstVisible ? '지표면온도 레이어 끄기' : '지표면온도 레이어 켜기';
    btn.classList.toggle('on', lstVisible);
    btn.setAttribute('aria-pressed', String(lstVisible));
  }
  function renderLSTLegend() {
    const el = document.getElementById('lstLegend');
    if (!lstVisible) { el.innerHTML = '<b>지표면온도 레이어 꺼짐</b>'; el.classList.add('off'); return; }
    el.classList.remove('off');
    const f = app.data.lst.features[0], b = f.properties.breaks[lstMetric], label = { mean: '평균 LST', p90: '상위 10% LST', max: '최고 LST', above33: '33℃ 이상 관측비율' }[lstMetric];
    el.innerHTML = `<b>${label}</b>` + lstColors().map((c, i) => `<div class="legend-row"><i class="swatch" style="background:${c}"></i>${b[i]} ~ ${b[i + 1]}${lstMetric === 'above33' ? '%' : '℃'}</div>`).join('');
  }

  const opened = { main: false, policy: false, lst: false };
  function invalidate(which) {
    const map = { main: mainMap, policy: policyMap, lst: lstMap }[which];
    setTimeout(() => {
      map?.invalidateSize();
      if (map && !opened[which]) {
        if (which === 'main' || which === 'policy') map.setView(C().center, C().zoom, { animate: false });
        else map.fitBounds(bounds, { padding: [18, 18] });
        opened[which] = true;
      }
    }, 80);
  }
  function init(A) {
    app = A;
    prepareBoundary();
    initMain();
    initPolicy();
    initLST();
  }
  return { init, setMetric, setGrade, setDong, setBase, searchGrid, setPolicyType, setRoadLayer, setLSTMetric, toggleLST, invalidate };
})();
