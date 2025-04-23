document.addEventListener("DOMContentLoaded", () => {
    // Configuração dos elementos da página
    const elements = {
        filtro: document.getElementById("filtro"),
        produtoSelect: document.getElementById("produto"),
        quantidade: document.getElementById("quantidade"),
        adicionarBtn: document.getElementById("adicionar"),
        tabelaBody: document.querySelector("#tabela-orcamento tbody"),
        totalSpan: document.getElementById("total"),
        produtoNome: document.getElementById("produto-nome"),
        produtoUnidade: document.getElementById("produto-unidade"),
        produtoPreco: document.getElementById("produto-preco"),
        produtoDataBase: document.getElementById("produto-data-base"),
        exportarBtn: document.getElementById("exportar"),
        logoutBtn: document.getElementById("logout")
    };

    // Estado da aplicação
    const state = {
        orcamento: [],
        total: 0,
        produtos: []
    };

    // Utilitários
    const utils = {
        formatarValor: (valor) => 
            Number(valor).toLocaleString("pt-BR", {style: "currency", currency: "BRL"}),
        
        formatarData: (dataStr) => {
            if (!dataStr || dataStr === "N/A") return "N/A";
            try {
                const [day, month, year] = dataStr.split('/');
                return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
            } catch {
                return dataStr;
            }
        },
        
        diffMeses: (dataStr1, dataStr2) => {
            try {
                const parseDate = (str) => {
                    const [d, m, y] = str.split('/');
                    return new Date(y, m-1, d);
                };
                const date1 = parseDate(dataStr1);
                const date2 = parseDate(dataStr2);
                return (date2.getFullYear() - date1.getFullYear()) * 12 + 
                       (date2.getMonth() - date1.getMonth());
            } catch {
                return 0;
            }
        }
    };

    // Serviços de API
    const api = {
        carregarProdutos: async () => {
            try {
                const res = await fetch("/produtos");
                if (!res.ok) throw new Error(res.statusText);
                state.produtos = await res.json();
                render.produtos(state.produtos);
            } catch (err) {
                console.error("Falha ao carregar produtos:", err);
                alert("Erro ao carregar produtos. Verifique o console.");
            }
        },
        
        atualizarPreco: async (produto) => {
            try {
                const res = await fetch("/atualizar-preco", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({ produto })
                });
                
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.erro || "Erro na atualização");
                }
                
                return await res.json();
            } catch (err) {
                console.error("Falha na atualização:", err);
                throw err;
            }
        },
        
        exportarOrcamento: async () => {
            try {
                const res = await fetch("/exportar-orcamento", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({ orcamento: state.orcamento })
                });
                
                if (!res.ok) throw new Error("Erro na exportação");
                
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'orcamento.xlsx';
                a.click();
                window.URL.revokeObjectURL(url);
                
            } catch (err) {
                console.error("Erro ao exportar:", err);
                alert("Falha ao exportar orçamento");
            }
        }
    };

    // Renderização
    const render = {
        produtos: (produtos) => {
            elements.produtoSelect.innerHTML = produtos.map(p => {
                const texto = `${p.PRODUTO} - ${p.UNIDADE}`;
                return `<option value='${JSON.stringify(p)}' title="${texto}">
                    ${texto.length > 50 ? texto.substring(0,47)+"..." : texto}
                </option>`;
            }).join("");
        },
        
        orcamento: () => {
            elements.tabelaBody.innerHTML = state.orcamento.map((item, idx) => `
                <tr>
                    <td>${item.PRODUTO}</td>
                    <td>${item.UNIDADE}</td>
                    <td>${item.quantidade}</td>
                    <td>${utils.formatarValor(item.PREÇO)}</td>
                    <td>${utils.formatarValor(item.subtotal)}</td>
                    <td>${utils.formatarData(item.DATA_BASE)}</td>
                    <td><button class="btn-excluir" data-index="${idx}">Excluir</button></td>
                </tr>
            `).join("");
            
            // Adiciona eventos aos botões de excluir
            document.querySelectorAll('.btn-excluir').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    app.removerItem(parseInt(e.target.dataset.index));
                });
            });
            
            elements.totalSpan.textContent = utils.formatarValor(state.total);
        },
        
        detalhesProduto: (produto) => {
            elements.produtoNome.textContent = produto.PRODUTO;
            elements.produtoUnidade.textContent = produto.UNIDADE;
            elements.produtoPreco.textContent = utils.formatarValor(produto.PREÇO);
            elements.produtoDataBase.textContent = utils.formatarData(produto.DATA_BASE);
        }
    };

    // Lógica da aplicação
    const app = {
        init: () => {
            api.carregarProdutos();
            
            // Event listeners
            elements.filtro.addEventListener("input", (e) => {
                const termo = e.target.value.toLowerCase();
                const filtrados = state.produtos.filter(p => 
                    p.PRODUTO.toLowerCase().includes(termo)
                );
                render.produtos(filtrados);
            });
            
            elements.produtoSelect.addEventListener("change", (e) => {
                const produto = JSON.parse(e.target.value);
                render.detalhesProduto(produto);
            });
            
            elements.adicionarBtn.addEventListener("click", app.adicionarItem);
            elements.exportarBtn.addEventListener("click", api.exportarOrcamento);
            elements.logoutBtn.addEventListener("click", () => {
                window.location.href = "/logout";
            });
        },
        
        adicionarItem: async () => {
            const produto = JSON.parse(elements.produtoSelect.value);
            const quantidade = parseFloat(elements.quantidade.value.replace(',', '.'));
            
            if (isNaN(quantidade) || quantidade <= 0) {
                alert("Quantidade inválida!");
                return;
            }
            
            // Verifica atualização de preço
            const mesesDesatualizado = utils.diffMeses(
                produto.DATA_BASE, 
                new Date().toLocaleDateString('pt-BR')
            );
            
            if (mesesDesatualizado > 3) {
                try {
                    const confirmar = confirm(
                        `Preço desatualizado há ${mesesDesatualizado} meses. Atualizar índice IPCA mais atual?`
                    );
                    
                    if (confirmar) {
                        const resultado = await api.atualizarPreco(produto);
                        Object.assign(produto, resultado);
                        
                        // Atualiza o select
                        const option = elements.produtoSelect.querySelector(
                            `option[value='${JSON.stringify(produto)}']`
                        );
                        if (option) option.value = JSON.stringify(produto);
                        
                        render.detalhesProduto(produto);
                        alert("Preço atualizado com o índice IPCA mais atual com sucesso!");
                    }
                } catch (err) {
                    alert(`Erro: ${err.message || "Falha na atualização"}`);
                }
            }
            
            // Adiciona ao orçamento
            const subtotal = produto.PREÇO * quantidade;
            state.orcamento.push({...produto, quantidade, subtotal});
            state.total += subtotal;
            
            render.orcamento();
            elements.quantidade.value = "";
        },
        
        removerItem: (index) => {
            const [removido] = state.orcamento.splice(index, 1);
            state.total -= removido.subtotal;
            render.orcamento();
        }
    };

    // Inicialização
    app.init();
});
