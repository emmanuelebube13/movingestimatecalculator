  <script>
    // --- PART G: CHANGELOG & VERSIONING ---
    const APP_VERSION = '2.0.0';
    const CHANGELOG = [
      { v: '2.0.0', date: '2026-09-08', notes: [
          'Route model rebuilt: depot → pickup → dropoff → depot with truckload loops',
          'Removed misleading round-trip / one-way toggle',
          'HST handled correctly for registered businesses (ITCs + collected tax split out)',
          'Drive time and depot overhead now paid labour',
          'Added Truck + Driver and Labor Only service modes',
          'All rates moved to an editable Rate Card'
      ]},
      { v: '1.0.0', date: '2026-08-01', notes: ['Initial estimator[cite: 1]'] }
    ];

    // --- PART A: CENTRAL CONFIGURATION ---
    const DEFAULT_CONFIG = {
      business: {
        hstRegistered: false, // TODO(owner): Confirm if registered.
        hstRate: 0.15,
        legalName: 'HRM Moving',
      },
      depot: { label: 'U-Haul Dartmouth', address: '' },
      travel: {
        avgSpeedKmh: 45,
        depotOverheadHours: 0.75,
        perLoadPenaltyHours: 0.3,
        billDeadheadToClient: false
      },
      wages: { mover: 22, driver: 26 },
      surcharges: { perStairFlight: 30, stairHoursPerFlight: 0.2, heavyItemDefault: 0, accessDefault: 0 },
      equipment: { kitCostPerJob: 15, truckOnlyRiskPremium: 35 },
      margin: { fullService: 0.35, truckDriver: 0.45, laborOnly: 0.50 },
      minimums: {
        fullService: { hours: 2.0, floor: 180 },
        truckDriver: { hours: 2.0, floor: 150 }, // TODO(owner): Confirm floor.
        laborOnly:   { hours: 2.0, floor: 120 }
      },
      advisory: { opportunityCostPerTruckDay: 250, diyWarnMultiplier: 1.6 },
      quoteRounding: 5,
      trucks: {
        van:    { base: 19.95, perKm: 0.79, fuelKm: 0.25, maxVol: 245,  name: "9' Cargo Van" },
        '10ft': { base: 19.95, perKm: 0.89, fuelKm: 0.30, maxVol: 402,  name: "10' Box Truck" },
        '15ft': { base: 29.95, perKm: 0.99, fuelKm: 0.35, maxVol: 764,  name: "15' Box Truck" },
        '20ft': { base: 39.95, perKm: 1.09, fuelKm: 0.40, maxVol: 1016, name: "20' Box Truck" },
        '26ft': { base: 39.95, perKm: 1.19, fuelKm: 0.45, maxVol: 1682, name: "26' Box Truck" }
      },
      presets: {
        single: { truck: 'van',  movers: 2, hours: 1.5, insurance: 16 },
        micro:  { truck: 'van',  movers: 2, hours: 2.0, insurance: 16 },
        '1bed': { truck: '10ft', movers: 2, hours: 3.0, insurance: 16 },
        '2bed': { truck: '15ft', movers: 2, hours: 4.5, insurance: 20 },
        '3bed': { truck: '20ft', movers: 3, hours: 6.0, insurance: 25 },
        '4bed': { truck: '26ft', movers: 4, hours: 7.5, insurance: 30 }
      }
    };

    let CONFIG = loadConfig();

    function deepMerge(target, source) {
      for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && key in target) Object.assign(source[key], deepMerge(target[key], source[key]));
      }
      Object.assign(target || {}, source);
      return target;
    }

    function loadConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem('hrm.config.v2'));
        return saved ? deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), saved) : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      } catch { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
    }
    
    function saveConfig() {
      localStorage.setItem('hrm.config.v2', JSON.stringify(CONFIG));
      calculate();
    }
    
    function resetConfig() {
      localStorage.removeItem('hrm.config.v2');
      CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      initRateCard();
      calculate();
    }

    // State Variables
    let mode = 'fullService';
    let activeTemplate = 'standard';
    let templateDirty = false;
    let lastResult = null;
    
    // Helpers
    const ceilTo = (v, step) => Math.ceil(v / step) * step;

    // DOM Elements Mapping
    const els = {
      modeBtns: document.querySelectorAll('.mode-btn'),
      loadPreset: document.getElementById('loadPreset'),
      customItemSection: document.getElementById('customItemSection'),
      itemQtys: document.querySelectorAll('.item-qty'),
      totalVol: document.getElementById('totalVolumeDisplay'),
      truckSize: document.getElementById('truckSize'),
      insurance: document.getElementById('insuranceCost'),
      equipmentBlock: document.getElementById('equipmentBlock'),
      truckOnlyWarning: document.getElementById('truckOnlyWarning'),
      dZA: document.getElementById('dZA'),
      dAB: document.getElementById('dAB'),
      dBZ: document.getElementById('dBZ'),
      dBZContainer: document.getElementById('dBZContainer'),
      mirrorReturn: document.getElementById('mirrorReturn'),
      truckLoads: document.getElementById('truckLoads'),
      routeSummary: document.getElementById('routeSummaryStrip'),
      handlingHours: document.getElementById('handlingHours'),
      driveHoursDisp: document.getElementById('driveHoursDisplay'),
      paidHoursDisp: document.getElementById('paidHoursDisplay'),
      hoursOverride: document.getElementById('hoursOverride'),
      crewSize: document.getElementById('crewSize'),
      crewContainer: document.getElementById('crewSizeContainer'),
      stairs: document.getElementById('stairsCount'),
      heavy: document.getElementById('heavyFee'),
      access: document.getElementById('accessFee'),
      warningStrip: document.getElementById('warningStrip'),
      templateOutput: document.getElementById('templateOutput'),
      regenQuoteBtn: document.getElementById('regenQuoteBtn'),
      copyBtns: [document.getElementById('copyBtn'), document.getElementById('mobileCopyBtn')],
      tabBtns: document.querySelectorAll('.tab-btn'),
      // Displays
      topQuote: document.getElementById('topQuoteDisplay'),
      mobQuote: document.getElementById('mobileQuoteDisplay'),
      hstBadge: document.getElementById('hstBadge'),
      audit: {
        clientPays: document.getElementById('auditClientPays'),
        hstCol: document.getElementById('auditHstCollected'),
        netRev: document.getElementById('auditNetRevenue'),
        equipCost: document.getElementById('auditEquipCost'),
        labCost: document.getElementById('auditLaborCost'),
        netProf: document.getElementById('auditNetProfit'),
        marginPct: document.getElementById('auditMarginPct'),
        profHr: document.getElementById('auditProfitPerHr'),
        hstOwed: document.getElementById('auditHstOwed'),
        hstBlock: document.getElementById('hstRemitBlock')
      },
      // Config Inputs
      profitMargin: document.getElementById('profitMargin'),
      marginLabel: document.getElementById('marginLabel'),
      customerName: document.getElementById('customerName'),
      leadSource: document.getElementById('leadSource'),
      cfg: {
        moverWage: document.getElementById('cfgMoverWage'),
        driverWage: document.getElementById('cfgDriverWage'),
        stairFee: document.getElementById('cfgStairFee'),
        speed: document.getElementById('cfgSpeed'),
        mFull: document.getElementById('cfgMarginFull'),
        mTruck: document.getElementById('cfgMarginTruck'),
        mLabor: document.getElementById('cfgMarginLabor'),
        depotOverhead: document.getElementById('cfgDepotOverhead'),
        loadPenalty: document.getElementById('cfgLoadPenalty'),
        stairHours: document.getElementById('cfgStairHours'),
        kitCost: document.getElementById('cfgKitCost'),
        riskPremium: document.getElementById('cfgRiskPremium'),
        minFull: document.getElementById('cfgMinFull'),
        minTruck: document.getElementById('cfgMinTruck'),
        minLabor: document.getElementById('cfgMinLabor'),
        opportunityCost: document.getElementById('cfgOpportunityCost'),
        diyMultiplier: document.getElementById('cfgDiyMultiplier'),
        rounding: document.getElementById('cfgRounding'),
        hstRegistered: document.getElementById('cfgHstRegistered'),
      }
    };

    // --- INITIALIZATION ---
    
    
    

    

    function init() {
      // Populate Truck Dropdown
      els.truckSize.innerHTML = Object.entries(CONFIG.trucks).map(([k, v]) => 
        `<option value="${k}">${v.name} ($${v.base} + $${v.perKm}/km)</option>`
      ).join('');
      
      initRateCard();
            attachListeners();
      applyModeRules();
      calculate();
    }

    function initRateCard() {
      if(els.cfg.moverWage) els.cfg.moverWage.value = CONFIG.wages.mover;
      if(els.cfg.stairFee) els.cfg.stairFee.value = CONFIG.surcharges.perStairFlight;
      if(els.cfg.mFull) els.cfg.mFull.value = CONFIG.margin.fullService;
      if(els.cfg.mTruck) els.cfg.mTruck.value = CONFIG.margin.truckDriver;
      if(els.cfg.mLabor) els.cfg.mLabor.value = CONFIG.margin.laborOnly;
      if(els.cfg.depotOverhead) els.cfg.depotOverhead.value = CONFIG.travel.depotOverheadHours;
      if(els.cfg.loadPenalty) els.cfg.loadPenalty.value = CONFIG.travel.perLoadPenaltyHours;
      if(els.cfg.stairHours) els.cfg.stairHours.value = CONFIG.surcharges.stairHoursPerFlight;
      
      
      
    }

    // --- EVENT LISTENERS ---
    function attachListeners() {
      const capBar = document.getElementById('capacityActionBar');
      if(capBar) {
        capBar.addEventListener('click', (e) => {
          const btn = e.target.closest('button'); if (!btn) return;
          if (btn.dataset.act === 'loops') {
            els.truckLoads.value = btn.dataset.n;
          } else {
            const order = ['van','10ft','15ft','20ft','26ft'];
            const i = order.indexOf(els.truckSize.value);
            if (i < order.length - 1) els.truckSize.value = order[i + 1];
          }
          calculate();
        });
      }
      // Mode Switching
      els.modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          els.modeBtns.forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
            b.classList.add('text-slate-600', 'bg-transparent');
          });
          e.target.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
          e.target.classList.remove('text-slate-600', 'bg-transparent');
          mode = e.target.dataset.mode;
          applyModeRules();
          calculate();
        });
      });

      // Mirror Checkbox
      els.mirrorReturn.addEventListener('change', (e) => {
        els.dBZ.disabled = e.target.checked;
        if (e.target.checked) els.dBZ.value = els.dZA.value;
        calculate();
      });
      els.dZA.addEventListener('input', () => {
        if (els.mirrorReturn.checked) els.dBZ.value = els.dZA.value;
      });

      // Custom Preset
      els.loadPreset.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
          els.customItemSection.classList.remove('hidden');
          recalculateCustomLoad();
        } else {
          els.customItemSection.classList.add('hidden');
          const p = CONFIG.presets[e.target.value];
          if (p) {
            els.truckSize.value = p.truck;
            els.crewSize.value = p.movers;
            els.handlingHours.value = p.hours;
            els.insurance.value = p.insurance;
          }
        }
        calculate();
      });
      
      els.itemQtys.forEach(inp => inp.addEventListener('input', () => {
        if (els.loadPreset.value === 'custom') recalculateCustomLoad();
        calculate();
      }));

      // Template edits
      els.templateOutput.addEventListener('input', () => {
        templateDirty = true;
        els.regenQuoteBtn.classList.remove('hidden');
      });
      els.regenQuoteBtn.addEventListener('click', () => {
        templateDirty = false;
        els.regenQuoteBtn.classList.add('hidden');
        calculate();
      });

      // Config Listeners
      Object.values(els.cfg).forEach(inp => { if (inp) inp.addEventListener('change', updateConfigFromUI); });
      if(els.customerName) els.customerName.addEventListener('input', calculate);
      document.getElementById('resetConfigBtn').addEventListener('click', resetConfig);

      // Template Tabs
      els.tabBtns.forEach(btn => btn.addEventListener('click', (e) => {
        els.tabBtns.forEach(b => { 
           b.classList.remove('bg-blue-600', 'text-white'); 
           b.classList.add('text-slate-600'); 
           b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('bg-blue-600', 'text-white');
        btn.setAttribute('aria-selected', 'true');
        btn.classList.remove('text-slate-600');
        activeTemplate = btn.dataset.template;
        templateDirty = false;
        els.regenQuoteBtn.classList.add('hidden');
        calculate();
      }));

      // Copy Buttons
      els.copyBtns.forEach(b => b.addEventListener('click', () => {
        els.templateOutput.select();
        navigator.clipboard.writeText(els.templateOutput.value);
        b.textContent = 'Copied!';
        setTimeout(() => b.textContent = 'Copy', 2000);
      }));

      // Job Save
      document.getElementById('saveQuoteBtn').addEventListener('click', () => {
         window.print();
         setTimeout(() => {
           const cn = document.getElementById('customerName');
           if (cn) cn.value = '';
           const ls = document.getElementById('leadSource');
           if (ls) ls.value = 'website';
           if (typeof newQuote === 'function') newQuote();
         }, 1000);
      });
      const newQuote = () => {
         els.loadPreset.value = '1bed';
         els.customItemSection.classList.add('hidden');
         els.dZA.value = 12; els.dAB.value = 15; els.dBZ.value = 12;
         els.mirrorReturn.checked = true;
         els.dBZ.disabled = true;
         els.truckLoads.value = 1;
         els.handlingHours.value = 3.0;
         els.crewSize.value = 2;
         els.insurance.value = 16;
         els.stairs.value = 0; els.heavy.value = 0; els.access.value = 0;
         els.hoursOverride.checked = false;
         els.paidHoursDisp.readOnly = true;
         templateDirty = false;
         els.regenQuoteBtn.classList.add('hidden');
         calculate();
         window.scrollTo(0, 0);
      };
      document.getElementById('newQuoteBtn').addEventListener('click', newQuote);
      document.getElementById('mobileNewQuoteBtn').addEventListener('click', newQuote);
      
      
      
      
      
      

      
      // Changelog logic
      document.getElementById('versionHeader').addEventListener('click', () => {
        document.getElementById('changelogOverlay').classList.remove('hidden');
        document.getElementById('changelogDrawer').classList.remove('hidden');
        document.getElementById('changelogDrawer').classList.add('flex');
      });
      const closeChangelog = () => {
        document.getElementById('changelogOverlay').classList.add('hidden');
        document.getElementById('changelogDrawer').classList.add('hidden');
        document.getElementById('changelogDrawer').classList.remove('flex');
      };
      document.getElementById('closeChangelog').addEventListener('click', closeChangelog);
      document.getElementById('changelogOverlay').addEventListener('click', closeChangelog);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChangelog(); });

      const clBody = document.getElementById('changelogBody');
      if (clBody) {
        clBody.innerHTML = CHANGELOG.map(c => `
          <div class="border-b border-slate-100 pb-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">v${c.v}</span>
              <span class="text-slate-500">${c.date}</span>
            </div>
            <ul class="list-disc pl-4 space-y-1 text-slate-700">
              ${c.notes.map(n => `<li>${n}</li>`).join('')}
            </ul>
          </div>
        `).join('');
      }

      // Standard Triggers
      [els.truckSize, els.insurance, els.dZA, els.dAB, els.dBZ, els.truckLoads, els.handlingHours, els.crewSize, els.stairs, els.heavy, els.access].forEach(el => {
        el.addEventListener('input', calculate);
      });
      els.hoursOverride.addEventListener('change', (e) => {
        els.paidHoursDisp.readOnly = !e.target.checked;
        if (!e.target.checked) calculate();
        else { els.paidHoursDisp.focus(); calculate(); }
      });
      els.paidHoursDisp.addEventListener('input', () => { if (els.hoursOverride.checked) calculate(); });
      
    }

    function applyModeRules() {
      const hasTruck = mode !== 'laborOnly';
      els.equipmentBlock.classList.toggle('hidden', !hasTruck);
      els.truckOnlyWarning.classList.toggle('hidden', mode !== 'truckDriver');
      els.crewContainer.classList.toggle('hidden', mode === 'truckDriver');
      if (mode === 'truckDriver') els.crewSize.value = 1; // force 1 driver
      
      const dABContainer = document.getElementById('dABContainer');
      const mirrorReturnLabel = document.getElementById('mirrorReturnLabel');
      const truckLoadsContainer = document.getElementById('truckLoadsContainer');
      const dZALabel = document.getElementById('dZALabel');
      
      if (mode === 'laborOnly') {
        if(dABContainer) dABContainer.classList.add('hidden');
        els.dBZContainer.classList.add('hidden');
        if(truckLoadsContainer) truckLoadsContainer.classList.add('hidden');
        if(mirrorReturnLabel) mirrorReturnLabel.classList.add('hidden');
        if(dZALabel) dZALabel.textContent = "Travel to site (km)";
      } else {
        if(dABContainer) dABContainer.classList.remove('hidden');
        els.dBZContainer.classList.remove('hidden');
        if(truckLoadsContainer) truckLoadsContainer.classList.remove('hidden');
        if(mirrorReturnLabel) mirrorReturnLabel.classList.remove('hidden');
        if(dZALabel) dZALabel.textContent = "Depot to Pickup (km)";
      }
    }

    function updateConfigFromUI() {
      const p = (el, f) => { if (!el) return f; const v = el.value; return v === '' || isNaN(parseFloat(v)) ? f : parseFloat(v); };
      CONFIG.wages.mover = p(els.cfg.moverWage, 22);
      CONFIG.surcharges.perStairFlight = p(els.cfg.stairFee, 30);
      
      CONFIG.travel.depotOverheadHours = p(els.cfg.depotOverhead, 0.75);
      CONFIG.travel.perLoadPenaltyHours = p(els.cfg.loadPenalty, 0.3);
      CONFIG.surcharges.stairHoursPerFlight = p(els.cfg.stairHours, 0.2);
      
      CONFIG.margin.fullService = p(els.cfg.mFull, 0.35);
      CONFIG.margin.truckDriver = p(els.cfg.mTruck, 0.45);
      CONFIG.margin.laborOnly = p(els.cfg.mLabor, 0.50);
      
      
      
      saveConfig();
    }

    // --- LOGIC FUNCTIONS ---
    function recalculateCustomLoad() {
      let totalVol = 0;
      els.itemQtys.forEach(i => totalVol += (parseInt(i.value) || 0) * (parseFloat(i.dataset.vol) || 0));
      els.totalVol.textContent = `${totalVol} cu. ft.`;

      // Auto sizing logic based on presets map
      if (totalVol <= 200) { els.truckSize.value = 'van'; els.handlingHours.value = Math.max(1.5, Math.round((totalVol/100)*10)/10); els.crewSize.value = 2; els.insurance.value = 16; }
      else if (totalVol <= 380) { els.truckSize.value = '10ft'; els.handlingHours.value = Math.max(2.0, Math.round((totalVol/120)*10)/10); els.crewSize.value = 2; els.insurance.value = 16; }
      else if (totalVol <= 720) { els.truckSize.value = '15ft'; els.handlingHours.value = Math.max(3.5, Math.round((totalVol/150)*10)/10); els.crewSize.value = 2; els.insurance.value = 20; }
      else if (totalVol <= 980) { els.truckSize.value = '20ft'; els.handlingHours.value = Math.max(5.0, Math.round((totalVol/170)*10)/10); els.crewSize.value = 3; els.insurance.value = 25; }
      else { els.truckSize.value = '26ft'; els.handlingHours.value = Math.max(6.5, Math.round((totalVol/180)*10)/10); els.crewSize.value = 4; els.insurance.value = 30; }
    }

    function checkCapacity(totalVolume, truckKey, loads) {
      const cap = CONFIG.trucks[truckKey].maxVol;
      const needed = Math.ceil(totalVolume / (cap * 0.85)); // 85% usable
      return { needed, overCapacity: needed > loads, cap };
    }

    function computeRoute() {
      const dZA = parseFloat(els.dZA.value) || 0;
      const dAB = parseFloat(els.dAB.value) || 0;
      const dBZ = parseFloat(els.dBZ.value) || 0;
      const loads = Math.max(1, parseInt(els.truckLoads.value) || 1);
      
      const odometerKm = mode === 'laborOnly' ? dZA * 2 : dZA + dBZ + dAB * (2 * loads - 1);
      const loadedKm = mode === 'laborOnly' ? 0 : dAB * loads;
      const deadheadKm = odometerKm - loadedKm;
      
      return { odometerKm, loadedKm, deadheadKm, loads, dZA, dAB, dBZ };
    }

    function computeHours(handlingHours, odometerKm, loads, stairFlights) {
      const stairHours = stairFlights * CONFIG.surcharges.stairHoursPerFlight;
      const loadPenalty = (loads - 1) * CONFIG.travel.perLoadPenaltyHours;
      
      // As requested, Drive + Admin is fixed at 30 minutes (0.5)
      const driveAdmin = 0.5;
      
      const rawPaid = handlingHours + stairHours + loadPenalty + driveAdmin;
      const paidHours = els.hoursOverride.checked ? parseFloat(els.paidHoursDisp.value) : ceilTo(rawPaid, 0.25);
      
      const billableHours = ceilTo(handlingHours + stairHours + loadPenalty + driveAdmin, 0.25);
      
      return { driveHours, paidHours, billableHours };
    }

    // --- MAIN CORE CALCULATION (PART F) ---
    function calculate() {
      if (els.hstBadge) els.hstBadge.classList.add('hidden');
      CONFIG.business.hstRegistered = false;
      els.warningStrip.innerHTML = '';
      const warnings = [];

      const t = CONFIG.trucks[els.truckSize.value];
      const biz = CONFIG.business;
      const hasTruck = mode !== 'laborOnly';
      const handlingHours = parseFloat(els.handlingHours.value) || 0;
      const stairs = parseInt(els.stairs.value) || 0;
      const movers = parseInt(els.crewSize.value) || 1;
      const insurance = parseFloat(els.insurance.value) || 0;
      const heavy = parseFloat(els.heavy.value) || 0;
      const access = parseFloat(els.access.value) || 0;

      // 1. Model Travel & Time
      const route = computeRoute();
      const hrs = computeHours(handlingHours, route.odometerKm, route.loads, stairs);
      
      // Update Route UI
      els.routeSummary.textContent = mode === 'laborOnly' 
        ? `Travel to site: ${route.dZA} km (Drive pay only)`
        : `Depot → Pickup ${route.dZA}km · Pickup → Dropoff ${route.dAB}km (×${route.loads}) · Dropoff → Depot ${route.dBZ}km = ${route.odometerKm}km total · ${route.loadedKm} km loaded`;
      
      if (!els.hoursOverride.checked) els.paidHoursDisp.value = hrs.paidHours;
      els.driveHoursDisp.value = `${hrs.driveHours.toFixed(1)}h`;

      // Capacity Check
      if (hasTruck && els.loadPreset.value === 'custom') {
        let vol = 0; els.itemQtys.forEach(i => vol += (parseInt(i.value)||0)*(parseFloat(i.dataset.vol)||0));
        const cap = checkCapacity(vol, els.truckSize.value, route.loads);
        if (cap.overCapacity) warnings.push(`⚠️ Load volume (${vol} cu ft) exceeds selected truck/loops. Set loops to ${cap.needed} or upgrade truck size.`);
      }

      // 2. Truck Cost (with HST handling)
      let truckPreTax = 0, recoverableItc = 0, truckClientCost = 0;
      if (hasTruck) {
        const days = Math.max(1, Math.ceil(hrs.paidHours / 24));
        const rentalPreTax = t.base * days + t.perKm * route.odometerKm + insurance * days;
        const rentalHst = rentalPreTax * biz.hstRate;
        
        const fuelGross = route.odometerKm * t.fuelKm;
        const fuelPreTax = fuelGross / (1 + biz.hstRate);
        const fuelHst = fuelGross - fuelPreTax;

        if (biz.hstRegistered) {
          truckPreTax = rentalPreTax + fuelPreTax; 
          recoverableItc = rentalHst + fuelHst;
        } else {
          truckPreTax = rentalPreTax + rentalHst + fuelGross;
        }
      }

      // 3. Labor Cost
      let laborCost = movers * hrs.paidHours * CONFIG.wages.mover;

      // 4. Direct Cost
      const directCost = truckPreTax + laborCost;

      // 5. Price
      const m = els.profitMargin ? (parseFloat(els.profitMargin.value) || 0) / 100 : CONFIG.margin[mode];
      
      const surcharge = stairs * CONFIG.surcharges.perStairFlight + heavy + access;

      let subtotal = directCost / (1 - m) + surcharge;


      const clientTotal = biz.hstRegistered ? subtotal * (1 + biz.hstRate) : subtotal;
      const displayTotal = ceilTo(clientTotal, CONFIG.quoteRounding);

      // 6. Back out Truth
      const netRevenue = biz.hstRegistered ? displayTotal / (1 + biz.hstRate) : displayTotal;
      const hstCollected = displayTotal - netRevenue;
      const hstOwed = Math.max(0, hstCollected - recoverableItc);
      const netProfit = netRevenue - directCost;
      const marginPct = netRevenue > 0 ? netProfit / netRevenue : 0;
      const profitPerHr = hrs.paidHours > 0 ? netProfit / hrs.paidHours : 0;

      

      // 7. Render UI
      warnings.forEach(w => {
        els.warningStrip.innerHTML += `<div class="bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs font-bold">${w}</div>`;
      });

      if(els.topQuote) els.topQuote.textContent = `$${displayTotal.toFixed(2)}`;
      if(els.mobQuote) els.mobQuote.textContent = `$${displayTotal.toFixed(2)}`;
      
      els.audit.clientPays.textContent = `$${displayTotal.toFixed(2)}`;
      
      els.audit.equipCost.textContent = `$${truckPreTax.toFixed(2)}`;
      els.audit.labCost.textContent = `$${laborCost.toFixed(2)}`;
      els.audit.netProf.textContent = `$${netProfit.toFixed(2)}`;
      els.audit.marginPct.textContent = `(${(marginPct*100).toFixed(1)}% margin)`;
      els.audit.profHr.textContent = `$${profitPerHr.toFixed(2)} / paid hr`;
      
      if(els.audit.hstBlock) els.audit.hstBlock.style.display = 'none';
      if (biz.hstRegistered) els.hstBadge.classList.remove('hidden');
      else els.hstBadge.classList.add('hidden');

      lastResult = {
        mode, loadType: els.loadPreset.value,
        truck: hasTruck ? els.truckSize.value : null,
        loads: route.loads,
        route: { dZA: route.dZA, dAB: route.dAB, dBZ: route.dBZ, odometerKm: route.odometerKm },
        hours: { handling: handlingHours, drive: +hrs.driveHours.toFixed(2), paid: hrs.paidHours, billable: hrs.billableHours },
        quotedTotal: displayTotal, netRevenue, directCost,
        projectedProfit: netProfit,
        movers, stairs,
        subtotal, hstCollected,
      };

      // Part D: Quote Shape Line
      const minH = 2;
      let tripCharge = 0;
      if (hasTruck) {
        const deadheadCost = t.perKm * route.deadheadKm * (mode === 'laborOnly' ? 0 : 1);
        tripCharge = ceilTo((t.base + insurance + deadheadCost) / (1 - m), CONFIG.quoteRounding);
      }
      const impliedHourly = hrs.billableHours > 0 ? Math.max(0, (subtotal - tripCharge) / hrs.billableHours) : 0;
      let shapeText = hasTruck 
        ? `$${tripCharge.toFixed(0)} dispatch + $${impliedHourly.toFixed(0)}/hr, ${minH} hr minimum` 
        : `$${impliedHourly.toFixed(0)}/hr per mover, ${minH} hr minimum`;
      if (impliedHourly < 15) shapeText = `Flat rate $${subtotal.toFixed(0)}, ${minH} hr minimum`;
      const qst = document.getElementById('quoteShapeText');
      if (qst) qst.textContent = shapeText;

      // Part E: Capacity Actions rendering
      const capBar = document.getElementById('capacityActionBar');
      if (capBar) {
         if (hasTruck && els.loadPreset.value === 'custom') {
           let vol = 0; els.itemQtys.forEach(i => vol += (parseInt(i.value)||0)*(parseFloat(i.dataset.vol)||0));
           const cap = checkCapacity(vol, els.truckSize.value, route.loads);
           if (cap.overCapacity) {
             capBar.innerHTML = `
               <button data-act="loops" data-n="${cap.needed}" class="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold">Set loops to ${cap.needed}</button>
               <button data-act="bigger" class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold">Use next larger truck</button>
             `;
             capBar.classList.remove('hidden');
           } else {
             capBar.classList.add('hidden');
           }
         } else {
           capBar.classList.add('hidden');
         }
      }

      // 8. Update Templates
      if (!templateDirty) {
        const truckName = hasTruck ? t.name : 'Labor Only';
        const cName = els.customerName && els.customerName.value.trim() ? els.customerName.value.trim() : 'there';
        const bh = hrs.billableHours;
        const hrRate = subtotal / bh;
        
        let tpl = "";
        const hstStr = biz.hstRegistered ? " (incl NS HST)" : "";
        const shapeStr = " " + shapeText;
        if (mode === 'truckDriver') {
           const msg = `Your driver operates the truck only and does not load or carry. Your crew supplies all lifting.`;
           if (activeTemplate === 'standard') tpl = `Hi ${cName}! For our Truck + Driver service, your quote is $${displayTotal.toFixed(2)}${hstStr}. We supply the ${truckName}, driver, and equipment with a ${minH}-hour minimum; most jobs of this size land around ${bh} hours. ${msg}${shapeStr}`;
           else if (activeTemplate === 'detailed') tpl = `Truck + Driver Breakdown:\n• Truck: ${truckName}\n• Duration: ${minH} hrs minimum (est. ${bh} hrs)\n• Total: $${displayTotal.toFixed(2)}${hstStr}\n${msg}`;
           else tpl = `Booking Confirmed: Truck & Driver\nTotal: $${displayTotal.toFixed(2)}\nPlease e-Transfer deposit to secure dispatch.`;
        } else if (mode === 'laborOnly') {
           const msg = `Our crew works in and around your vehicle or building; you provide the truck and any transport.`;
           if (activeTemplate === 'standard') tpl = `Hi ${cName}! For Labor-Only, your quote is $${displayTotal.toFixed(2)}${hstStr}. This covers a professional ${movers}-mover team with a ${minH}-hour minimum; most jobs of this size land around ${bh} hours. ${msg}${shapeStr}`;
           else if (activeTemplate === 'detailed') tpl = `Labor-Only Breakdown:\n• Team: ${movers} Professional Movers\n• Duration: ${minH} hrs minimum (est. ${bh} hrs)\n• Total: $${displayTotal.toFixed(2)}${hstStr}\n${msg}`;
           else tpl = `Booking Confirmed: Labor Only\nTotal: $${displayTotal.toFixed(2)}\nPlease e-Transfer deposit to secure the crew.`;
        } else {
           if (activeTemplate === 'standard') tpl = `Hi ${cName}! Based on your move details, your quote is $${displayTotal.toFixed(2)}${hstStr}. This includes a ${truckName}, a ${movers}-mover professional crew, and dispatch with a ${minH}-hour minimum; most jobs of this size land around ${bh} hours.${shapeStr}`;
           else if (activeTemplate === 'detailed') tpl = `Detailed Breakdown:\n• Team: ${movers} Movers + ${truckName}\n• Duration: ${minH} hrs minimum (est. ${bh} hrs)\n• Total: $${displayTotal.toFixed(2)}${hstStr} (Includes U-Haul, fuel, labor, equipment)`;
           else tpl = `Booking Confirmed: Full Service\nTotal: $${displayTotal.toFixed(2)} (${movers} movers + ${truckName})\nPlease e-Transfer deposit to secure your slot.`;
        }
        els.templateOutput.value = tpl;
      }
    }

    // Run
    init();
  </script>
