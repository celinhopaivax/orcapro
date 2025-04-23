import os
import requests
from flask import Flask, jsonify, request, send_file, render_template, redirect, url_for
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from datetime import datetime
import pandas as pd
from io import BytesIO
import shutil

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "sua_chave_secreta_aqui")

# Configuração do Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# Simulação de usuário
class User(UserMixin):
    def __init__(self, user_id):
        self.id = user_id

USERS = {"paiva": {"password": "321654"}}

@login_manager.user_loader
def load_user(user_id):
    return User(user_id) if user_id in USERS else None

def consultar_ipca(data_base):
    """Consulta otimizada à API do BCB"""
    try:
        if not data_base or not isinstance(data_base, str):
            return 0

        parts = data_base.split('/')
        if len(parts) != 3:
            return 0

        day, month, year = parts
        data_inicio = f"01/{month}/{year}"
        data_fim = datetime.now().strftime("%d/%m/%Y")

        url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial={data_inicio}&dataFinal={data_fim}"
        
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        
        dados = response.json()
        if not dados or not isinstance(dados, list):
            return 0

        fator_acumulado = 1.0
        for periodo in dados:
            try:
                if isinstance(periodo, dict) and 'valor' in periodo:
                    fator_acumulado *= (1 + float(periodo['valor'])/100)
            except (ValueError, TypeError):
                continue

        return (fator_acumulado - 1) * 100

    except requests.exceptions.RequestException as e:
        print(f"Erro na API BCB: {str(e)}")
        return 0
    except Exception as e:
        print(f"Erro inesperado: {str(e)}")
        return 0

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username in USERS and USERS[username]['password'] == password:
            user = User(username)
            login_user(user)
            return redirect(url_for('index'))
        return "Credenciais inválidas", 401
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/produtos')
@login_required
def listar_produtos():
    try:
        # Leitura com tratamento robusto de datas
        df = pd.read_excel("precos.xlsx")
        
        # Padroniza nomes de colunas
        df.columns = [col.strip().upper().replace(" ", "_") for col in df.columns]
        
        # Converte datas para o formato desejado
        df['DATA_BASE'] = pd.to_datetime(df['DATA_BASE'], errors='coerce').dt.strftime('%d/%m/%Y')
        df['DATA_BASE'] = df['DATA_BASE'].fillna('')
        
        required_columns = {'PRODUTO', 'UNIDADE', 'PREÇO', 'DATA_BASE'}
        if not required_columns.issubset(df.columns):
            missing = required_columns - set(df.columns)
            raise ValueError(f"Colunas faltando: {missing}")
        
        df = df.sort_values(by="PRODUTO")
        return jsonify(df.to_dict(orient="records"))
        
    except Exception as e:
        print(f"Erro ao carregar produtos: {str(e)}")
        return jsonify({"erro": str(e)}), 500

@app.route('/atualizar-preco', methods=['POST'])
@login_required
def atualizar_preco():
    try:
        dados = request.get_json()
        if not dados or 'produto' not in dados:
            return jsonify({"erro": "Dados inválidos"}), 400

        produto = dados['produto']
        if not all(k in produto for k in ['PRODUTO', 'PREÇO', 'DATA_BASE']):
            return jsonify({"erro": "Estrutura inválida"}), 400

        ipca = consultar_ipca(produto['DATA_BASE'])
        if ipca <= 0:
            return jsonify({"erro": "IPCA não calculado"}), 400

        novo_preco = round(float(produto['PREÇO']) * (1 + ipca/100), 2)
        nova_data = datetime.now().strftime("%d/%m/%Y")

        # Leitura com tratamento especial para datas
        df = pd.read_excel("precos.xlsx")
        
        # Padroniza nomes de colunas
        df.columns = [col.strip().upper().replace(" ", "_") for col in df.columns]
        
        # Converte a coluna de data para string para preservar o formato
        df['DATA_BASE'] = pd.to_datetime(df['DATA_BASE'], errors='coerce').dt.strftime('%d/%m/%Y')
        
        mask = df['PRODUTO'] == produto['PRODUTO']
        
        if not mask.any():
            return jsonify({"erro": "Produto não encontrado"}), 404

        # Backup
        if not os.path.exists("backups"):
            os.makedirs("backups")
        backup_path = f"backups/precos_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        shutil.copy2("precos.xlsx", backup_path)

        # Atualiza os dados
        df.loc[mask, 'PREÇO'] = novo_preco
        df.loc[mask, 'DATA_BASE'] = nova_data
        
        # Salva mantendo o formato das datas
        with pd.ExcelWriter("precos.xlsx", engine='openpyxl', datetime_format='dd/mm/yyyy') as writer:
            df.to_excel(writer, index=False)

        return jsonify({
            "PREÇO": novo_preco,
            "DATA_BASE": nova_data,
            "mensagem": "Preço atualizado com sucesso"
        })

    except Exception as e:
        print(f"Erro na atualização: {str(e)}")
        return jsonify({"erro": str(e)}), 500

@app.route('/exportar-orcamento', methods=['POST'])
@login_required
def exportar_orcamento():
    try:
        data = request.get_json()
        if not data or 'orcamento' not in data:
            return jsonify({"erro": "Dados inválidos"}), 400

        df = pd.DataFrame(data['orcamento'])
        if df.empty:
            return jsonify({"erro": "Orçamento vazio"}), 400

        df = df[["PRODUTO", "UNIDADE", "quantidade", "PREÇO", "subtotal", "DATA_BASE"]]
        df.columns = ["Produto", "Unidade", "Quantidade", "Preço Unitário", "Subtotal", "Data Base"]

        output = BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            df.to_excel(writer, index=False, sheet_name='Orçamento')
        
        output.seek(0)
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='orcamento.xlsx'
        )

    except Exception as e:
        print(f"Erro ao exportar: {str(e)}")
        return jsonify({"erro": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
