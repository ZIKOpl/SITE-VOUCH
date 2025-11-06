document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("modal-overlay");
  const panel = document.getElementById("modal-panel");
  const modalContent = document.getElementById("modal-content");
  const closeBtn = document.querySelector(".modal-close");
  const search = document.getElementById("search");
  const clearSearch = document.getElementById("clearSearch");
  const grid = document.getElementById("vouchGrid");
  const openCreate = document.getElementById("openCreate");

  // Sécurité : éviter les erreurs si pas de modale sur la page
  if (overlay) overlay.hidden = true;

  function openModal(html) {
    if (!modalContent || !overlay || !panel) return console.warn("Modal non présente sur cette page");
    modalContent.innerHTML = html;
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add("show");
      panel.classList.add("show");
    });
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!overlay || !panel || !modalContent) return;
    overlay.classList.remove("show");
    panel.classList.remove("show");
    setTimeout(() => {
      overlay.hidden = true;
      modalContent.innerHTML = "";
      document.body.style.overflow = "";
    }, 180);
  }

  // Boutons de fermeture
  closeBtn?.addEventListener("click", closeModal);
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeModal();
  });

  // ===============================
  // 📦 Modal Détails d’un vouch
  // ===============================
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

  // ===============================
  // 🔍 Recherche dans les vouches
  // ===============================
  function filterCards(q) {
    if (!grid) return;
    const query = (q || "").trim().toLowerCase();
    const cards = grid.querySelectorAll(".vouch-card");
    cards.forEach(c => {
      const s = (c.dataset.search || "").toLowerCase();
      c.style.display = s.includes(query) ? "" : "none";
    });
  }

  if (search) {
    let t;
    search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => filterCards(search.value), 120);
    });
  }

  clearSearch?.addEventListener("click", () => {
    if (search) search.value = "";
    filterCards("");
    search?.focus();
  });

  // ===============================
  // 📝 Création d’un nouveau vouch
  // ===============================
  openCreate?.addEventListener("click", () => {
    const tpl = document.getElementById("tpl-create-vouch");
    if (!tpl) return;
    openModal(tpl.innerHTML);

    const form = document.getElementById("createVouchForm");
    const cancel = document.getElementById("cancelCreate");
    cancel?.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });

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
        showToast("✅ Vouch créé et envoyé sur Discord !", "success");
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showToast("❌ " + err.message, "error");
      }
    });
  });
});

// ===============================
// 🗑 Suppression d’un vouch (admin)
// ===============================
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-delete");
  if (!btn) return;
  const id = btn.getAttribute("data-del-id");
  if (!id) return;

  if (!confirm("Supprimer définitivement le vouch #" + id + " ?")) return;
  try {
    const res = await fetch("/api/vouch/" + id, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "Erreur suppression");
    showToast("✅ Vouch supprimé !", "success");
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    showToast("❌ " + err.message, "error");
  }
});

// ===============================
// 🔔 TOASTS (notifications)
// ===============================
window.showToast = function (message, type = "info", duration = 4000) {
  let container = document.getElementById("toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "toasts";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 50);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ===============================
// ✅ Boîte de confirmation personnalisée
// ===============================
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${message}</p>
        <div class="confirm-buttons">
          <button class="btn btn-primary yes">Oui</button>
          <button class="btn btn-outline no">Annuler</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector(".yes").onclick = () => {
      resolve(true);
      overlay.remove();
    };
    overlay.querySelector(".no").onclick = () => {
      resolve(false);
      overlay.remove();
    };
  });
}
