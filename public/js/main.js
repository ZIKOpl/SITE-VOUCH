document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("modal-overlay");
  const panel = document.getElementById("modal-panel");
  const modalContent = document.getElementById("modal-content");
  const closeBtn = document.querySelector(".modal-close");
  const search = document.getElementById("search");
  const clearSearch = document.getElementById("clearSearch");
  const grid = document.getElementById("vouchGrid");
  const openCreate = document.getElementById("openCreate");

  if (overlay) overlay.hidden = true;

  function openModal(html) {
    modalContent.innerHTML = html;
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      panel.classList.add("show");
    });
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    overlay.classList.remove("show");
    panel.classList.remove("show");
    setTimeout(() => {
      overlay.hidden = true;
      modalContent.innerHTML = "";
      document.body.style.overflow = "";
    }, 180);
  }
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  // Card -> details modal
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".vouch-card");
    if (!card) return;
    const vendor = card.dataset.vendor || "Inconnu";
    const note = Number(card.dataset.note || 0);
    const item = card.dataset.item || "";
    const price = card.dataset.price || "";
    const payment = card.dataset.payment || "";
    const author = card.dataset.author || "";
    const comment = (card.dataset.comment || "").trim() || "—";
    const date = card.dataset.date || "";
    const stars = "⭐".repeat(note) + "✩".repeat(5 - note);
    openModal(`
      <h3>Vouch détaillé</h3>
      <div class="kv"><div class="k">Date</div><div>${date}</div></div>
      <div class="kv"><div class="k">Note</div><div><strong>${stars}</strong> (${note}/5)</div></div>
      <div class="kv"><div class="k">Vendeur</div><div>${vendor}</div></div>
      <div class="kv"><div class="k">Item</div><div>${item}</div></div>
      <div class="kv"><div class="k">Prix</div><div>${price}</div></div>
      <div class="kv"><div class="k">Paiement</div><div>${payment}</div></div>
      <div class="kv"><div class="k">Par</div><div>${author}</div></div>
      <div class="kv"><div class="k">Commentaire</div><div>${comment}</div></div>
    `);
  });

  // Search filter
  function filterCards(q){
    if (!grid) return;
    const query = (q || "").trim().toLowerCase();
    const cards = grid.querySelectorAll(".vouch-card");
    cards.forEach(c => {
      const s = (c.dataset.search || "").toLowerCase();
      c.style.display = s.includes(query) ? "" : "none";
    });
  }
  if (search){
    let t;
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => filterCards(search.value), 120);
    });
  }
  if (clearSearch){
    clearSearch.addEventListener("click", () => {
      if (search) search.value = "";
      filterCards("");
      search?.focus();
    });
  }

  // Create vouch (open form)
  if (openCreate){
    openCreate.addEventListener("click", () => {
      const tpl = document.getElementById("tpl-create-vouch");
      if (!tpl) return;
      openModal(tpl.innerHTML);

      const form = document.getElementById("createVouchForm");
      const cancel = document.getElementById("cancelCreate");
      cancel?.addEventListener("click", (e)=>{ e.preventDefault(); closeModal(); });

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        try {
          const res = await fetch("/api/vouch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.message || "Erreur requête");
          closeModal();
          alert("✅ Vouch créé et envoyé sur Discord !");
          location.reload();
        } catch (err) {
          alert("❌ " + err.message);
        }
      });
    });
  }
});


// Admin: delete vouch
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;
  const id = btn.getAttribute("data-del-id");
  if (!id) return;
  if (!confirm("Supprimer définitivement le vouch #"+id+" ?")) return;
  try {
    const res = await fetch("/api/vouch/" + id, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "Erreur suppression");
    alert("✅ Vouch supprimé. Prochain numéro: #" + json.nextId);
    location.reload();
  } catch (err) {
    alert("❌ " + err.message);
  }
});

// ===============================
// 🔔 SYSTÈME DE NOTIFICATIONS
// ===============================
window.showToast = function (message, type = "info", duration = 4000) {
  const container = document.getElementById("toasts");
  if (!container) return console.error("Conteneur de toast introuvable");

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Disparition automatique
  setTimeout(() => {
    toast.style.animation = "toastFadeOut 0.5s ease forwards";
    setTimeout(() => toast.remove(), 500);
  }, duration);
};
