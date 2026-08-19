window.YCompare = (() => {
  let initialized = false;

  function init({ data, num, pct, esc, openDong }) {
    if (initialized) return;
    initialized = true;

    const dongNames = data.summary.dong_summary.map((x) => x.dong);
    const riskTypes = new Set(['종합취약지역', '우선확대관리지역', '거주 단독 5등급', '활동 단독 5등급']);
    const finite = (value) => Number.isFinite(Number(value));
    const values = (rows, key) => rows.map((x) => Number(x[key])).filter(Number.isFinite);
    const avg = (rows, key) => {
      const v = values(rows, key);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const weightedAvg = (rows, valueKey, weightKey) => {
      const pairs = rows.map((x) => [Number(x[valueKey]), Math.max(0, Number(x[weightKey]) || 0)])
        .filter(([value, weight]) => Number.isFinite(value) && weight > 0);
      const weight = pairs.reduce((sum, pair) => sum + pair[1], 0);
      return weight ? pairs.reduce((sum, pair) => sum + pair[0] * pair[1], 0) / weight : null;
    };
    const quantile = (rows, key, q) => {
      const sorted = values(rows, key).sort((a, b) => a - b);
      if (!sorted.length) return null;
      const position = (sorted.length - 1) * q;
      const lower = Math.floor(position);
      const upper = Math.min(sorted.length - 1, lower + 1);
      return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    };
    const mean = (v) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    const std = (v) => {
      const m = mean(v);
      return Math.sqrt(mean(v.map((x) => (x - m) ** 2))) || 1;
    };
    const groupFeatures = (features, key) => {
      const out = Object.fromEntries(dongNames.map((dong) => [dong, []]));
      features.forEach((feature) => {
        const dong = feature.properties[key];
        if (out[dong]) out[dong].push(feature);
      });
      return out;
    };
    const properties = (featureGroup) => Object.fromEntries(Object.entries(featureGroup)
      .map(([dong, features]) => [dong, features.map((feature) => feature.properties)]));

    function geometryPoints(geometry) {
      const out = [];
      const walk = (coordinates) => {
        if (!Array.isArray(coordinates)) return;
        if (coordinates.length >= 2 && finite(coordinates[0]) && finite(coordinates[1])) {
          out.push([Number(coordinates[0]), Number(coordinates[1])]);
          return;
        }
        coordinates.forEach(walk);
      };
      walk(geometry?.coordinates);
      return out;
    }

    function geometryCenter(geometry) {
      const points = geometryPoints(geometry);
      if (!points.length) return null;
      const lng = points.map((x) => x[0]);
      const lat = points.map((x) => x[1]);
      return [(Math.min(...lng) + Math.max(...lng)) / 2, (Math.min(...lat) + Math.max(...lat)) / 2];
    }

    function pointInRing(point, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i][0]); const yi = Number(ring[i][1]);
        const xj = Number(ring[j][0]); const yj = Number(ring[j][1]);
        const crosses = ((yi > point[1]) !== (yj > point[1]))
          && point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || Number.EPSILON) + xi;
        if (crosses) inside = !inside;
      }
      return inside;
    }

    function pointInBoundary(point, feature) {
      const geometry = feature.geometry;
      if (geometry.type === 'Polygon') return pointInRing(point, geometry.coordinates[0]);
      if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInRing(point, polygon[0]));
      return false;
    }

    function distanceMeters(a, b) {
      const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
      const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
      const dy = (a[1] - b[1]) * 110540;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function clusterStats(features) {
      const points = features.map((feature) => geometryCenter(feature.geometry)).filter(Boolean);
      const visited = new Set();
      const sizes = [];
      points.forEach((point, start) => {
        if (visited.has(start)) return;
        const queue = [start];
        visited.add(start);
        let size = 0;
        while (queue.length) {
          const current = queue.pop();
          size += 1;
          points.forEach((candidate, index) => {
            if (!visited.has(index) && distanceMeters(points[current], candidate) <= 160) {
              visited.add(index);
              queue.push(index);
            }
          });
        }
        sizes.push(size);
      });
      const largest = sizes.length ? Math.max(...sizes) : 0;
      return { clusterCount: sizes.length, largestCluster: largest, largestClusterShare: pct(largest, points.length) };
    }

    const resFeatures = groupFeatures(data.residential.features, 'dong');
    const actFeatures = groupFeatures(data.activity.features, 'dong');
    const diagFeatures = groupFeatures(data.diagnosis.features, 'dong_res');
    const resGroup = properties(resFeatures);
    const actGroup = properties(actFeatures);
    const diagGroup = properties(diagFeatures);
    const boundaryFeatures = data.boundary.features.filter((feature) => dongNames.includes(feature.properties.dong));

    const gridDong = new Map();
    data.residential.features.forEach((feature) => gridDong.set(feature.properties.grid_id, feature.properties.dong));
    data.activity.features.forEach((feature) => gridDong.set(feature.properties.grid_id, feature.properties.dong));
    data.diagnosis.features.forEach((feature) => gridDong.set(feature.properties.grid_id, feature.properties.dong_res));

    function candidateDong(feature) {
      const p = feature.properties;
      const ids = [p.grid_id, ...(Array.isArray(p.grid_ids) ? p.grid_ids : [])].filter(Boolean);
      for (const id of ids) if (gridDong.has(id)) return gridDong.get(id);
      const center = geometryCenter(feature.geometry);
      const boundary = center && boundaryFeatures.find((item) => pointInBoundary(center, item));
      if (boundary) return boundary.properties.dong;
      return dongNames.includes(p.dong) ? p.dong : null;
    }

    const policyGroups = Object.fromEntries(dongNames.map((dong) => [dong, []]));
    const policyPointSets = data.policy.features.map((feature) => {
      const all = geometryPoints(feature.geometry);
      const stride = Math.max(1, Math.ceil(all.length / 160));
      const sampled = all.filter((_, index) => index % stride === 0);
      const center = geometryCenter(feature.geometry);
      const points = center ? [center, ...sampled] : sampled;
      const dong = candidateDong(feature);
      if (dong && policyGroups[dong]) policyGroups[dong].push(feature);
      return { feature, points, dong };
    });

    const componentDefs = [
      { label: '거주 기후', key: 'climateRes', theme: '기후노출 저감', action: '열환경 개선과 고온공간 저감시설을 우선 검토합니다.' },
      { label: '거주 민감도', key: 'sensitivityRes', theme: '취약인구 보호', action: '취약인구 밀집 생활권의 보호·안부확인과 쉼터 수용여력을 우선 검토합니다.' },
      { label: '거주 대응부족', key: 'responseRes', theme: '생활권 시설공백 보완', action: '무더위쉼터 접근성과 수용여력의 공백을 우선 보완합니다.' },
      { label: '활동 기후', key: 'climateAct', theme: '활동공간 열저감', action: '보행·대기 공간의 그늘과 노면 열환경 개선을 우선 검토합니다.' },
      { label: '활동 민감도', key: 'sensitivityAct', theme: '활동수요 보호', action: '활동인구와 버스 이용이 집중되는 시간·공간을 중심으로 대책을 배치합니다.' },
      { label: '활동 대응부족', key: 'responseAct', theme: '보행시설 공백 보완', action: '그늘막·쿨링포그·정류장 차양의 공급 공백을 우선 보완합니다.' }
    ];

    const baseStats = {};
    dongNames.forEach((dong) => {
      const r = resGroup[dong]; const a = actGroup[dong]; const g = diagGroup[dong];
      const gf = diagFeatures[dong];
      const riskFeatures = gf.filter((feature) => riskTypes.has(feature.properties.diagnosis));
      const count = (type) => g.filter((x) => x.diagnosis === type).length;
      const joint = count('종합취약지역'); const priority = count('우선확대관리지역');
      const resOnly = count('거주 단독 5등급'); const actOnly = count('활동 단독 5등급');
      const riskCount = joint + priority + resOnly + actOnly;
      const clusters = clusterStats(riskFeatures);
      const candidates = policyGroups[dong];
      const candidateTypes = {};
      candidates.forEach((feature) => {
        const type = feature.properties.policy_type;
        candidateTypes[type] = (candidateTypes[type] || 0) + 1;
      });
      const riskPoints = riskFeatures.map((feature) => geometryCenter(feature.geometry)).filter(Boolean);
      const covered = riskPoints.filter((point) => policyPointSets.some((candidate) => candidate.points
        .some((candidatePoint) => distanceMeters(point, candidatePoint) <= 500))).length;
      const candidateCoverage = pct(covered, riskPoints.length);
      const pairedResMean = avg(g, 'score_res'); const pairedActMean = avg(g, 'score_act');
      baseStats[dong] = {
        dong, resN: r.length, actN: a.length, commonN: g.length,
        resMean: avg(r, 'score'), actMean: avg(a, 'score'), pairedResMean, pairedActMean,
        combinedMean: avg(g, 'combined_score'), combinedP90: quantile(g, 'combined_score', .9),
        resWeighted: weightedAvg(r, 'score', 'total_population') ?? avg(r, 'score'),
        actWeighted: weightedAvg(a, 'score', 'activity_pop_time_weighted_mean') ?? avg(a, 'score'),
        res45: r.filter((x) => Number(x.grade) >= 4).length,
        act45: a.filter((x) => Number(x.grade) >= 4).length,
        res45Rate: pct(r.filter((x) => Number(x.grade) >= 4).length, r.length),
        act45Rate: pct(a.filter((x) => Number(x.grade) >= 4).length, a.length),
        joint, priority, resOnly, actOnly, riskCount, riskRate: pct(riskCount, g.length),
        indexGap: (pairedActMean ?? 0) - (pairedResMean ?? 0),
        climateRes: avg(r, 'climate'), sensitivityRes: avg(r, 'sensitivity'), responseRes: avg(r, 'response_lack'),
        climateAct: avg(a, 'climate'), sensitivityAct: avg(a, 'sensitivity'), responseAct: avg(a, 'response_lack'),
        ...clusters,
        candidateCount: candidates.length,
        candidateTypes,
        candidateCoverage,
        uncoveredRate: 100 - candidateCoverage,
        riskPerCandidate: candidates.length ? riskCount / candidates.length : null
      };
    });

    const allStats = Object.values(baseStats);
    const districtRisk = allStats.reduce((sum, x) => sum + x.riskCount, 0);
    allStats.forEach((x) => { x.burdenShare = pct(x.riskCount, districtRisk); });

    function assignPercentiles(key, output = `${key}Pct`) {
      const all = allStats.map((x) => Number(x[key])).filter(Number.isFinite);
      allStats.forEach((x) => {
        const value = Number(x[key]);
        x[output] = Number.isFinite(value) ? pct(all.filter((candidate) => candidate <= value).length, all.length) : 0;
      });
    }

    function applyRanks(key, output) {
      const rows = [...allStats].sort((a, b) => (Number(b[key]) || -Infinity) - (Number(a[key]) || -Infinity));
      let rank = 0; let previous = null;
      rows.forEach((x, index) => {
        const value = Number(x[key]);
        if (previous == null || Math.abs(value - previous) > 1e-9) rank = index + 1;
        x[output] = rank;
        previous = value;
      });
    }

    componentDefs.forEach((component) => {
      const all = allStats.map((x) => Number(x[component.key]));
      const m = mean(all); const sd = std(all);
      assignPercentiles(component.key, `${component.key}Pct`);
      allStats.forEach((x) => { x[`${component.key}Z`] = (Number(x[component.key]) - m) / sd; });
    });
    allStats.forEach((x) => {
      x.driver = [...componentDefs].sort((a, b) => x[`${b.key}Z`] - x[`${a.key}Z`])[0];
      x.driverPercentile = x[`${x.driver.key}Pct`];
    });

    const pairedResAll = allStats.map((x) => x.pairedResMean);
    const pairedActAll = allStats.map((x) => x.pairedActMean);
    const pairedResMeanAll = mean(pairedResAll); const pairedActMeanAll = mean(pairedActAll);
    const pairedResSd = std(pairedResAll); const pairedActSd = std(pairedActAll);
    allStats.forEach((x) => {
      x.balanceIndex = (x.pairedActMean - pairedActMeanAll) / pairedActSd - (x.pairedResMean - pairedResMeanAll) / pairedResSd;
    });

    ['combinedP90', 'riskCount', 'riskRate', 'resWeighted', 'actWeighted'].forEach((key) => assignPercentiles(key));
    allStats.forEach((x) => {
      x.demandPct = (x.resWeightedPct + x.actWeightedPct) / 2;
      x.priorityScore = (x.combinedP90Pct + x.riskCountPct + x.riskRatePct + x.demandPct) / 4;
    });
    applyRanks('priorityScore', 'priorityRank');
    applyRanks('pairedResMean', 'resRank'); applyRanks('pairedActMean', 'actRank');
    applyRanks('combinedMean', 'combinedRank'); applyRanks('riskRate', 'riskRank');
    applyRanks('resWeighted', 'resWeightedRank'); applyRanks('actWeighted', 'actWeightedRank');
    allStats.forEach((x) => {
      x.priorityTier = x.priorityRank <= 4 ? '우선검토' : x.priorityRank <= 8 ? '중점검토' : '상시관찰';
    });

    const compareSelects = [...document.querySelectorAll('.compare-select')];
    compareSelects.forEach((select) => {
      select.innerHTML = '<option value="">지역 선택</option>' + dongNames.map((dong) => `<option value="${dong}">${dong}</option>`).join('');
      select.onchange = renderCompare;
    });
    const topDongs = [...allStats].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 4);
    compareSelects.forEach((select, index) => { select.value = topDongs[index]?.dong || ''; });
    document.getElementById('compareTopBtn').onclick = () => {
      compareSelects.forEach((select, index) => { select.value = topDongs[index]?.dong || ''; });
      renderCompare();
    };
    document.getElementById('compareResetBtn').onclick = () => {
      compareSelects.forEach((select) => { select.value = ''; });
      renderCompare();
    };
    document.getElementById('compareRankMetric').onchange = renderAllDongRank;

    function compareBar(label, value, color, suffix = '점') {
      const width = Math.max(0, Math.min(100, Number(value) || 0));
      return `<div class="compare-bar-row"><span>${label}</span><div class="compare-bar-track"><i style="width:${width}%;background:${color || 'var(--nav)'}"></i></div><b>${num(value)}${suffix}</b></div>`;
    }

    function balanceLabel(x) {
      return x.balanceIndex >= .5 ? '보행·활동 상대우세형' : x.balanceIndex <= -.5 ? '거주 취약성 상대우세형' : '거주·활동 복합형';
    }

    function dongInterpret(x) {
      return `${balanceLabel(x)}이며, 유성구 대비 가장 두드러진 구성요소는 ${x.driver.label}(백분위 ${num(x.driverPercentile, 0)})입니다.`;
    }

    function riskColor(rate) {
      const index = Math.max(0, Math.min(4, Math.ceil((Number(rate) || 0) / 10) - 1));
      return APP_CONFIG.scoreColors[index];
    }

    function renderCompareScatter(chosen) {
      const all = allStats.filter((x) => finite(x.pairedResMean) && finite(x.pairedActMean));
      const xValues = all.map((x) => Number(x.pairedResMean)); const yValues = all.map((x) => Number(x.pairedActMean));
      const xmin = Math.floor(Math.min(...xValues) - 2); const xmax = Math.ceil(Math.max(...xValues) + 2);
      const ymin = Math.floor(Math.min(...yValues) - 2); const ymax = Math.ceil(Math.max(...yValues) + 2);
      const avgX = mean(xValues); const avgY = mean(yValues);
      const W = 620; const H = 350; const L = 54; const R = 18; const T = 25; const B = 43;
      const sx = (value) => L + (Number(value) - xmin) / (xmax - xmin) * (W - L - R);
      const sy = (value) => H - B - (Number(value) - ymin) / (ymax - ymin) * (H - T - B);
      const selected = new Set(chosen.map((x) => x.dong));
      let grid = '';
      for (let i = 0; i <= 4; i += 1) {
        const xv = xmin + (xmax - xmin) * i / 4; const yv = ymin + (ymax - ymin) * i / 4;
        grid += `<line class="scatter-grid" x1="${sx(xv)}" y1="${T}" x2="${sx(xv)}" y2="${H - B}"/><text class="scatter-label" x="${sx(xv)}" y="${H - 20}" text-anchor="middle">${num(xv)}</text>`;
        grid += `<line class="scatter-grid" x1="${L}" y1="${sy(yv)}" x2="${W - R}" y2="${sy(yv)}"/><text class="scatter-label" x="${L - 8}" y="${sy(yv) + 3}" text-anchor="end">${num(yv)}</text>`;
      }
      const points = all.map((x) => {
        const on = selected.has(x.dong); const px = sx(x.pairedResMean); const py = sy(x.pairedActMean);
        const radius = Math.min(13, 4 + Math.sqrt(x.riskCount) * .65 + (on ? 1.5 : 0));
        return `<g><circle class="scatter-dot ${on ? 'selected' : 'all'}" style="fill:${riskColor(x.riskRate)}" cx="${px}" cy="${py}" r="${radius}"><title>${x.dong}: 공통격자 거주 ${num(x.pairedResMean)}점, 활동 ${num(x.pairedActMean)}점, 관리대상 ${x.riskCount}개(${num(x.riskRate)}%)</title></circle>${on ? `<text class="scatter-name" x="${px + radius + 3}" y="${py - radius + 3}">${x.dong}</text>` : ''}</g>`;
      }).join('');
      document.getElementById('compareScatter').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="공통격자 기준 행정동별 거주 및 활동 취약지수 산점도">${grid}<line class="scatter-average" x1="${sx(avgX)}" y1="${T}" x2="${sx(avgX)}" y2="${H - B}"/><line class="scatter-average" x1="${L}" y1="${sy(avgY)}" x2="${W - R}" y2="${sy(avgY)}"/><text class="scatter-quadrant" x="${W - R - 5}" y="${T + 15}" text-anchor="end">두 지수 모두 상대적으로 높음</text><text class="scatter-quadrant" x="${L + 5}" y="${T + 15}">활동 상대우세</text><text class="scatter-quadrant" x="${W - R - 5}" y="${H - B - 8}" text-anchor="end">거주 상대우세</text>${points}<line class="scatter-axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/><line class="scatter-axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/><text class="scatter-label" x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">공통격자 취약계층 밀집형 평균</text><text class="scatter-label" x="14" y="${(T + H - B) / 2}" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle">공통격자 보행 노출 위험형 평균</text></svg>`;
    }

    function renderPolicyDirections(chosen) {
      document.getElementById('comparePolicyDirection').innerHTML = chosen.map((x) => `<article class="policy-direction-card"><span class="priority-tag">${x.priorityTier} ${x.priorityRank}위</span><h4>${x.dong}</h4><b>${balanceLabel(x)} · ${x.driver.theme}</b><p>${x.driver.action} 상대강도는 백분위 ${num(x.driverPercentile, 0)}, 관리대상 집중도는 ${num(x.riskRate)}%, P90은 ${num(x.combinedP90)}점입니다.</p></article>`).join('');
    }

    function diagnosisMixHTML(x) {
      const parts = [
        ['종합취약', x.joint, APP_CONFIG.diagnosisColors['종합취약지역']],
        ['우선확대', x.priority, APP_CONFIG.diagnosisColors['우선확대관리지역']],
        ['거주 단독', x.resOnly, APP_CONFIG.diagnosisColors['거주 단독 5등급']],
        ['활동 단독', x.actOnly, APP_CONFIG.diagnosisColors['활동 단독 5등급']]
      ];
      const total = Math.max(1, parts.reduce((sum, part) => sum + part[1], 0));
      return `<div class="diagnosis-mix-row"><div class="diagnosis-mix-head"><b>${x.dong}</b><span>관리대상 ${num(x.riskCount, 0)}개 · 공통격자의 ${num(x.riskRate)}%</span></div><div class="diagnosis-stack">${parts.map(([label, value, color]) => `<i style="width:${value / total * 100}%;background:${color}" title="${label} ${value}개"></i>`).join('')}</div><div class="diagnosis-mix-legend">${parts.map(([label, value, color]) => `<span><i style="background:${color}"></i>${label} ${num(value, 0)}</span>`).join('')}</div></div>`;
    }

    function renderRiskStructure(chosen) {
      const rows = chosen.map((x) => `<article class="compare-analysis-row"><div><b>${x.dong}</b><span>유성구 관리대상의 ${num(x.burdenShare)}%</span></div><dl><div><dt>규모</dt><dd>${num(x.riskCount, 0)}개</dd></div><div><dt>집중도</dt><dd>${num(x.riskRate)}%</dd></div><div><dt>P90</dt><dd>${num(x.combinedP90)}점</dd></div><div><dt>최대군집</dt><dd>${num(x.largestCluster, 0)}ha</dd></div></dl><small>${num(x.clusterCount, 0)}개 군집 · 최대군집이 관리대상의 ${num(x.largestClusterShare)}%</small></article>`).join('');
      document.getElementById('compareRiskStructure').innerHTML = `${rows}<p class="analysis-method-note">100m 관리대상 격자의 중심 간 거리가 160m 이하인 경우를 8방향 인접으로 연결했으며, 1개 격자를 약 1ha로 계산합니다.</p>`;
    }

    function renderPolicyOpportunity(chosen) {
      const rows = chosen.map((x) => {
        const types = Object.entries(x.candidateTypes).map(([type, count]) => `<span>${type} ${count}</span>`).join('');
        const ratio = x.riskPerCandidate == null ? '후보 없음' : `후보 1개당 관리대상 ${num(x.riskPerCandidate)}개`;
        return `<article class="compare-analysis-row"><div><b>${x.dong}</b><span>공간결합 정책후보 ${num(x.candidateCount, 0)}개</span></div><div class="candidate-type-list">${types || '<span>현재 후보 없음</span>'}</div><dl><div><dt>500m 포괄률</dt><dd>${num(x.candidateCoverage)}%</dd></div><div><dt>실행 부담</dt><dd>${ratio}</dd></div></dl></article>`;
      }).join('');
      document.getElementById('comparePolicyOpportunity').innerHTML = `${rows}<p class="analysis-method-note">격자코드와 후보 좌표를 행정동 경계에 공간결합했습니다. 포괄률은 현재 제안된 전체 정책후보와 관리대상 격자의 거리 기준이며 실제 시설 서비스율이 아닙니다.</p>`;
    }

    function renderAllDongRank() {
      const key = document.getElementById('compareRankMetric').value;
      const meta = {
        priorityScore: ['분석 우선순위', '점'], combinedMean: ['공통격자 평균', '점'],
        pairedResMean: ['공통격자 거주 평균', '점'], pairedActMean: ['공통격자 활동 평균', '점'],
        riskRate: ['관리대상 비율', '%'], riskCount: ['관리대상 규모', '개'], combinedP90: ['상위위험 P90', '점'],
        largestCluster: ['최대 연속군집', 'ha'], resWeighted: ['인구가중 거주점수', '점'], actWeighted: ['활동수요가중 점수', '점'],
        uncoveredRate: ['정책후보 500m 미포괄률', '%']
      }[key];
      const rows = [...allStats].sort((a, b) => (Number(b[key]) || -Infinity) - (Number(a[key]) || -Infinity));
      const max = Math.max(...rows.map((x) => Number(x[key]) || 0), 1);
      let rank = 0; let previous = null;
      const el = document.getElementById('compareAllRank');
      el.innerHTML = rows.map((x, index) => {
        const value = Number(x[key]);
        if (previous == null || Math.abs(value - previous) > 1e-9) rank = index + 1;
        previous = value;
        return `<button class="all-rank-row" data-dong="${x.dong}" title="${meta[0]}"><strong>${rank}</strong><span>${x.dong}</span><div><i style="width:${(value || 0) / max * 100}%"></i></div><b>${num(value)}${meta[1]}</b></button>`;
      }).join('');
      el.querySelectorAll('button').forEach((button) => {
        button.onclick = () => {
          const empty = compareSelects.find((select) => !select.value) || compareSelects[0];
          empty.value = button.dataset.dong;
          renderCompare();
        };
      });
    }

    function leaders(chosen, key) {
      const maximum = Math.max(...chosen.map((x) => Number(x[key]) || 0));
      return chosen.filter((x) => Math.abs((Number(x[key]) || 0) - maximum) < 1e-9);
    }

    function renderCompare() {
      const chosen = [...new Set(compareSelects.map((select) => select.value).filter(Boolean))].map((dong) => baseStats[dong]);
      const headline = document.getElementById('compareHeadline');
      if (!chosen.length) {
        headline.innerHTML = '<div class="empty-state">비교할 행정동을 선택하면 우선순위·위험구조·공간군집·정책 실행기회가 표시됩니다.</div>';
        ['compareBody', 'compareScatter', 'comparePolicyDirection', 'compareRiskStructure', 'comparePolicyOpportunity', 'compareScoreBars', 'compareGradeBars', 'compareDiagnosisMix', 'compareProfiles', 'compareHeatmap', 'compareTable', 'compareInsight'].forEach((id) => { document.getElementById(id).innerHTML = ''; });
        renderAllDongRank();
        return;
      }

      const priorityLeaders = leaders(chosen, 'priorityScore'); const burdenLeaders = leaders(chosen, 'riskCount');
      const concentrationLeaders = leaders(chosen, 'riskRate'); const severityLeaders = leaders(chosen, 'combinedP90');
      const label = (rows) => rows.map((x) => x.dong).join('·');
      headline.innerHTML = `<div class="compare-summary-chip"><span>분석 우선순위 최고</span><b>${label(priorityLeaders)} ${num(priorityLeaders[0].priorityScore)}점</b></div><div class="compare-summary-chip"><span>관리대상 규모 최대</span><b>${label(burdenLeaders)} ${num(burdenLeaders[0].riskCount, 0)}개</b></div><div class="compare-summary-chip"><span>관리대상 집중도 최고</span><b>${label(concentrationLeaders)} ${num(concentrationLeaders[0].riskRate)}%</b></div><div class="compare-summary-chip"><span>상위위험 P90 최고</span><b>${label(severityLeaders)} ${num(severityLeaders[0].combinedP90)}점</b></div>`;

      renderCompareScatter(chosen);
      renderPolicyDirections(chosen);
      renderRiskStructure(chosen);
      renderPolicyOpportunity(chosen);
      document.getElementById('compareBody').innerHTML = chosen.map((x) => `<article class="card compare-card"><div class="compare-card-head"><div><h3>${x.dong}</h3><span>4축 우선순위 ${num(x.priorityScore)}점 · 13개 동 중 ${x.priorityRank}위</span></div><strong class="priority-badge">${x.priorityRank}위</strong></div><div class="compare-card-kpis"><div><span>공통 거주 평균</span><b>${num(x.pairedResMean)}</b><small>${x.resRank}위</small></div><div><span>공통 활동 평균</span><b>${num(x.pairedActMean)}</b><small>${x.actRank}위</small></div><div><span>수요가중 거주</span><b>${num(x.resWeighted)}</b><small>${x.resWeightedRank}위</small></div><div><span>수요가중 활동</span><b>${num(x.actWeighted)}</b><small>${x.actWeightedRank}위</small></div></div>${compareBar('관리대상 집중도', x.riskRate, APP_CONFIG.gradeColors[5], '%')}${compareBar('전체 부담 점유율', x.burdenShare, APP_CONFIG.gradeColors[4], '%')}<p>${dongInterpret(x)}</p><button class="compare-map-link" data-dong="${x.dong}">통합지도에서 보기</button></article>`).join('');
      document.querySelectorAll('.compare-map-link').forEach((button) => { button.onclick = () => openDong(button.dataset.dong); });

      document.getElementById('compareScoreBars').innerHTML = chosen.map((x) => `<div class="compare-chart-group"><b>${x.dong}</b>${compareBar('취약계층 밀집형', x.pairedResMean, APP_CONFIG.gradeColors[5])}${compareBar('보행 노출 위험형', x.pairedActMean, APP_CONFIG.gradeColors[1])}</div>`).join('');
      document.getElementById('compareGradeBars').innerHTML = chosen.map((x) => `<div class="compare-chart-group"><b>${x.dong}</b>${compareBar('거주 4·5등급', x.res45Rate, APP_CONFIG.gradeColors[5], '%')}${compareBar('활동 4·5등급', x.act45Rate, APP_CONFIG.gradeColors[1], '%')}</div>`).join('');
      document.getElementById('compareDiagnosisMix').innerHTML = chosen.map(diagnosisMixHTML).join('');
      document.getElementById('compareProfiles').innerHTML = chosen.map((x) => `<div class="profile-column"><h4>${x.dong}</h4>${componentDefs.map((component) => compareBar(component.label, x[component.key], APP_CONFIG.scoreColors[Math.min(4, Math.floor((Number(x[component.key]) || 0) / 20))])).join('')}</div>`).join('');
      document.getElementById('compareHeatmap').innerHTML = `<table class="component-heatmap"><thead><tr><th>구성요소</th>${chosen.map((x) => `<th>${x.dong}</th>`).join('')}</tr></thead><tbody>${componentDefs.map((component) => `<tr><th>${component.label}</th>${chosen.map((x) => { const value = Number(x[component.key]) || 0; const percentile = x[`${component.key}Pct`]; const index = Math.max(0, Math.min(4, Math.ceil(percentile / 20) - 1)); return `<td style="background:${APP_CONFIG.scoreColors[index]}" title="${component.label} ${num(value)}점 · 유성구 백분위 ${num(percentile, 0)}"><b>${num(value)}</b><small>P${num(percentile, 0)}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
      document.getElementById('compareTable').innerHTML = '<thead><tr><th>행정동</th><th>분석 우선순위</th><th>공통격자 거주·활동</th><th>공통격자 차이</th><th>수요가중 거주·활동</th><th>관리대상 규모·집중도</th><th>P90</th><th>최대 연속군집</th><th>정책후보</th><th>후보 500m 포괄률</th></tr></thead><tbody>' + chosen.map((x) => `<tr><th>${x.dong}</th><td>${num(x.priorityScore)}점<br><small>${x.priorityRank}위 · ${x.priorityTier}</small></td><td>${num(x.pairedResMean)} · ${num(x.pairedActMean)}점<br><small>동일 공통격자 ${num(x.commonN, 0)}개</small></td><td>${x.indexGap >= 0 ? '+' : ''}${num(x.indexGap)}점<br><small>${balanceLabel(x)}</small></td><td>${num(x.resWeighted)} · ${num(x.actWeighted)}점</td><td>${num(x.riskCount, 0)}개 · ${num(x.riskRate)}%<br><small>전체 부담 ${num(x.burdenShare)}%</small></td><td>${num(x.combinedP90)}점</td><td>${num(x.largestCluster, 0)}ha<br><small>${num(x.clusterCount, 0)}개 군집</small></td><td>${num(x.candidateCount, 0)}개</td><td>${num(x.candidateCoverage)}%</td></tr>`).join('') + '</tbody>';

      const priorityTop = [...chosen].sort((a, b) => b.priorityScore - a.priorityScore)[0];
      const hiddenHotspot = [...chosen].sort((a, b) => (b.combinedP90 - b.combinedMean) - (a.combinedP90 - a.combinedMean))[0];
      const weakestCoverage = [...chosen].filter((x) => x.riskCount > 0).sort((a, b) => a.candidateCoverage - b.candidateCoverage)[0];
      const insights = [
        `${priorityTop.dong}은 심각도·규모·집중도·수요가중 점수를 동일 비중으로 합산한 분석 우선순위가 가장 높습니다.`,
        `${burdenLeaders[0].dong}은 관리대상 규모가 ${num(burdenLeaders[0].riskCount, 0)}개, ${concentrationLeaders[0].dong}은 동 내부 집중도가 ${num(concentrationLeaders[0].riskRate)}%로 규모와 집중도를 구분해 볼 필요가 있습니다.`,
        `${hiddenHotspot.dong}은 평균보다 P90이 ${num(hiddenHotspot.combinedP90 - hiddenHotspot.combinedMean)}점 높아 국지적 고위험 격자를 평균만으로 놓치기 쉽습니다.`,
        weakestCoverage ? `${weakestCoverage.dong}은 현재 정책후보의 500m 관리대상 포괄률이 ${num(weakestCoverage.candidateCoverage)}%로 선택 지역 중 가장 낮습니다.` : ''
      ].filter(Boolean);
      document.getElementById('compareInsight').innerHTML = `<h3>비교 해석</h3><ul>${insights.map((text) => `<li>${esc(text)}</li>`).join('')}</ul><p class="analysis-method-note">분석 우선순위는 P90 심각도, 관리대상 규모, 관리대상 집중도, 수요가중 점수의 13개 동 백분위를 각각 25%로 합산한 탐색용 지표입니다. 거주는 총인구, 활동은 시간가중 활동인구로 가중합니다. 정책후보 포괄률은 전체 후보 위치 기준이며 실제 시설 서비스율이 아닙니다.</p>`;
      renderAllDongRank();
    }

    renderCompare();
  }

  return { init };
})();
