const products = [
  { id: 1, name: "Nón Sen Thì Thầm", price: 590, category: "painted", color: "pink", style: "floral", tag: "Bán chạy", motif: "❀", bg: "#ead9d1", accent: "#a4413a", rotation: "-7deg" },
  { id: 2, name: "Nón Mộc An Nhiên", price: 390, category: "classic", color: "natural", style: "minimal", tag: "", motif: "", bg: "#e9e3d4", accent: "#7e6548", rotation: "5deg" },
  { id: 3, name: "Nón Lam Hội An", price: 720, oldPrice: 790, category: "painted", color: "blue", style: "heritage", tag: "Mới", motif: "〰", bg: "#cad9d9", accent: "#285c68", rotation: "-3deg" },
  { id: 4, name: "Nón Son Việt", price: 650, category: "fashion", color: "red", style: "modern", tag: "Độc bản", motif: "✦", bg: "#dec7b9", accent: "#a52f27", rotation: "7deg" },
  { id: 5, name: "Nón Trúc Bình Yên", price: 460, category: "classic", color: "natural", style: "heritage", tag: "", motif: "𖥧", bg: "#dce1d1", accent: "#506346", rotation: "-5deg" },
  { id: 6, name: "Nón Nguyệt Đương Đại", price: 840, category: "fashion", color: "black", style: "modern", tag: "Giới hạn", motif: "◐", bg: "#d5d0c8", accent: "#242a27", rotation: "4deg", dark: true },
  { id: 7, name: "Nón Mini Sắc Việt", price: 190, category: "mini", color: "red", style: "heritage", tag: "Quà tặng", motif: "✿", bg: "#ead9cb", accent: "#a83b2e", rotation: "-8deg" },
  { id: 8, name: "Nón Hồng Vân", price: 680, category: "painted", color: "pink", style: "floral", tag: "", motif: "❁", bg: "#ead5db", accent: "#a54d67", rotation: "6deg" }
];

const state = { category: "all", maxPrice: 1000, colors: new Set(), styles: new Set(), search: "", sort: "featured", cart: [], wishes: new Set() };
const grid = document.querySelector("#productGrid");
const money = value => `${new Intl.NumberFormat("vi-VN").format(value * 1000)}đ`;

function filteredProducts() {
  let result = products.filter(p =>
    (state.category === "all" || p.category === state.category) &&
    p.price <= state.maxPrice &&
    (!state.colors.size || state.colors.has(p.color)) &&
    (!state.styles.size || state.styles.has(p.style)) &&
    p.name.toLocaleLowerCase("vi").includes(state.search.toLocaleLowerCase("vi"))
  );
  if (state.sort === "price-asc") result.sort((a,b) => a.price-b.price);
  if (state.sort === "price-desc") result.sort((a,b) => b.price-a.price);
  if (state.sort === "name") result.sort((a,b) => a.name.localeCompare(b.name,"vi"));
  return result;
}

function renderProducts() {
  const list = filteredProducts();
  document.querySelector("#productCount").textContent = list.length;
  document.querySelector(".empty-state").hidden = list.length > 0;
  grid.hidden = list.length === 0;
  grid.innerHTML = list.map(p => `
    <article class="product-card">
      <div class="product-media">
        <div class="product-art" style="--bg:${p.bg};--rotation:${p.rotation};--hat1:${p.dark ? "#353533":"#d5bd84"};--hat2:${p.dark ? "#56544e":"#ecd9a5"};--accent:${p.accent};--motif:'${p.motif}'"><div class="product-hat"></div></div>
        ${p.tag ? `<span class="product-badge">${p.tag}</span>` : ""}
        <button class="wishlist-button ${state.wishes.has(p.id) ? "active":""}" data-wish="${p.id}" aria-label="Thêm ${p.name} vào yêu thích">
          <svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>
        </button>
      </div>
      <div class="product-info">
        <small>${categoryLabel(p.category)}</small>
        <h3>${p.name}</h3>
        <div class="rating" aria-label="5 trên 5 sao"><span>★★★★★</span><b>(5.0)</b></div>
        <p>${money(p.price)}${p.oldPrice ? `<del>${money(p.oldPrice)}</del>`:""}</p>
      </div>
      <button class="quick-add" data-add="${p.id}">Thêm nhanh vào giỏ</button>
    </article>`).join("");
}

function categoryLabel(category) { return ({classic:"Nón truyền thống",painted:"Nón họa",fashion:"Nón thời trang",mini:"Quà tặng & mini"})[category]; }
function showToast(message) { const toast=document.querySelector(".toast"); toast.textContent=message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove("show"),2200); }

function updateCart() {
  const box = document.querySelector(".cart-items");
  const empty = document.querySelector(".cart-empty");
  const footer = document.querySelector(".cart-footer");
  document.querySelector(".cart-count").textContent = state.cart.length;
  empty.hidden = state.cart.length > 0; footer.hidden = state.cart.length === 0;
  box.innerHTML = state.cart.map((id,index) => { const p=products.find(x=>x.id===id); return `<div class="cart-item"><div class="cart-thumb"><span></span></div><div><h4>${p.name}</h4><p>${money(p.price)}</p></div><button data-remove="${index}" aria-label="Xóa ${p.name}">×</button></div>`; }).join("");
  document.querySelector(".cart-total").textContent = money(state.cart.reduce((sum,id)=>sum+products.find(p=>p.id===id).price,0));
}

function toggleCart(open) { document.querySelector(".cart-drawer").classList.toggle("open",open); document.querySelector(".cart-drawer").setAttribute("aria-hidden",String(!open)); document.querySelector(".drawer-overlay").classList.toggle("open",open); document.body.style.overflow=open?"hidden":""; }

document.addEventListener("click", event => {
  const add = event.target.closest("[data-add]");
  if (add) { const id=Number(add.dataset.add); state.cart.push(id); updateCart(); showToast(`Đã thêm “${products.find(p=>p.id===id).name}” vào giỏ`); }
  const wish = event.target.closest("[data-wish]");
  if (wish) { const id=Number(wish.dataset.wish); state.wishes.has(id)?state.wishes.delete(id):state.wishes.add(id); document.querySelector(".wishlist-count").textContent=state.wishes.size; renderProducts(); showToast(state.wishes.has(id)?"Đã lưu vào danh sách yêu thích":"Đã bỏ khỏi danh sách yêu thích"); }
  const remove = event.target.closest("[data-remove]");
  if (remove) { state.cart.splice(Number(remove.dataset.remove),1); updateCart(); }
});

document.querySelectorAll(".category").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".category").forEach(x=>x.classList.remove("active")); button.classList.add("active"); state.category=button.dataset.category; renderProducts(); }));
document.querySelector("#priceRange").addEventListener("input", e => { state.maxPrice=Number(e.target.value); document.querySelector("#maxPriceLabel").textContent=money(state.maxPrice); renderProducts(); });
document.querySelectorAll(".color-list button").forEach(button => button.addEventListener("click",()=>{ button.classList.toggle("active"); state.colors.has(button.dataset.color)?state.colors.delete(button.dataset.color):state.colors.add(button.dataset.color); renderProducts(); }));
document.querySelectorAll(".checkbox-list input").forEach(input => input.addEventListener("change",()=>{ input.checked?state.styles.add(input.value):state.styles.delete(input.value); renderProducts(); }));
document.querySelector("#sortSelect").addEventListener("change",e=>{state.sort=e.target.value;renderProducts();});
document.querySelectorAll(".filter-title").forEach(button=>button.addEventListener("click",()=>{const group=button.parentElement;group.classList.toggle("open");button.querySelector("span").textContent=group.classList.contains("open")?"−":"+";}));

function resetFilters() { state.category="all";state.maxPrice=1000;state.colors.clear();state.styles.clear();state.search="";document.querySelector("#priceRange").value=1000;document.querySelector("#maxPriceLabel").textContent=money(1000);document.querySelectorAll(".color-list button").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".checkbox-list input").forEach(x=>x.checked=false);document.querySelectorAll(".category").forEach((x,i)=>x.classList.toggle("active",i===0));renderProducts();}
document.querySelector(".reset-filters").addEventListener("click",resetFilters);
document.querySelector(".empty-state button").addEventListener("click",resetFilters);
document.querySelector(".cart-toggle").addEventListener("click",()=>toggleCart(true));document.querySelector(".cart-close").addEventListener("click",()=>toggleCart(false));document.querySelector(".drawer-overlay").addEventListener("click",()=>{toggleCart(false);document.querySelector(".filters").classList.remove("open");});
document.querySelector(".announcement button").addEventListener("click",e=>e.currentTarget.parentElement.remove());

const searchPanel=document.querySelector(".search-panel");
function toggleSearch(open){searchPanel.classList.toggle("open",open);searchPanel.setAttribute("aria-hidden",String(!open));if(open)setTimeout(()=>document.querySelector("#searchInput").focus(),350);}
document.querySelector(".search-toggle").addEventListener("click",()=>toggleSearch(true));document.querySelector(".search-close").addEventListener("click",()=>toggleSearch(false));
document.querySelector("#searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){state.search=e.target.value.trim();toggleSearch(false);renderProducts();document.querySelector(".products-area").scrollIntoView({behavior:"smooth"});}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){toggleCart(false);toggleSearch(false);document.querySelector(".mobile-nav").classList.remove("open");document.querySelector(".filters").classList.remove("open");}});

document.querySelector(".mobile-filter-toggle").addEventListener("click",()=>{document.querySelector(".filters").classList.add("open");document.querySelector(".drawer-overlay").classList.add("open");});
document.querySelector(".menu-toggle").addEventListener("click",()=>document.querySelector(".mobile-nav").classList.add("open"));
document.querySelector(".mobile-nav-close").addEventListener("click",()=>document.querySelector(".mobile-nav").classList.remove("open"));
document.querySelectorAll(".mobile-nav a").forEach(a=>a.addEventListener("click",()=>document.querySelector(".mobile-nav").classList.remove("open")));
document.querySelectorAll(".view-switch button").forEach((button,index)=>button.addEventListener("click",()=>{
  document.querySelectorAll(".view-switch button").forEach(x=>x.classList.remove("active"));
  button.classList.add("active");
  grid.classList.toggle("list-view",index===1);
}));

renderProducts(); updateCart();
