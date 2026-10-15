import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/* -------------------------------------------------------------------------- */
/* Configuração da API                                                         */
/* -------------------------------------------------------------------------- */

const BASE_URL = 'http://10.137.11.6';

// ⚠️ Ajuste estes dois caminhos para as rotas reais do seu backend.
// (As URLs de listagem e atualização chegaram truncadas na mensagem,
// então usei como base o padrão da rota de visualização:
// /api/sensor/status/visualizar/s1)
const LIST_PATH = '/api/sensor/status/listar';
const UPDATE_PATH = '/api/sensor/status/atualizar';

const REQUEST_TIMEOUT_MS = 8000;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

// O backend pode devolver 0/1, true/false ou "0"/"1". Normalizamos tudo para boolean.
const toBoolean = (value) => {
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

const toSensor = (item) => ({
  codigo: item.codigo,
  tipo: item.tipo,
  ativo: toBoolean(item.status),
});

const iconForType = (tipo) => {
  switch (String(tipo).toLowerCase()) {
    case 'luminosidade':
      return 'sunny-outline';
    case 'infravermelho':
      return 'radio-outline';
    case 'umidade':
      return 'water-outline';
    default:
      return 'hardware-chip-outline';
  }
};

const capitalize = (text) =>
  text && text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;

// fetch com timeout, para não deixar o app preso caso o servidor não responda.
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Componente do item da lista                                                 */
/* -------------------------------------------------------------------------- */

const SensorCard = React.memo(({ sensor, pending, onToggle }) => {
  const color = sensor.ativo ? COLORS.active : COLORS.inactive;

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: sensor.ativo ? COLORS.activeSoft : COLORS.inactiveSoft },
        ]}
      >
        <Ionicons name={iconForType(sensor.tipo)} size={26} color={color} />
      </View>

      <View style={styles.info}>
        <Text style={styles.code}>{sensor.codigo}</Text>
        <Text style={styles.type}>{capitalize(sensor.tipo)}</Text>

        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.statusText, { color }]}>
            {sensor.ativo ? 'Ativo' : 'Inativo'}
          </Text>
        </View>
      </View>

      <View style={styles.action}>
        {pending ? (
          <ActivityIndicator size="small" color={COLORS.ink} />
        ) : (
          <Switch
            value={sensor.ativo}
            onValueChange={() => onToggle(sensor)}
            trackColor={{ false: COLORS.inactiveSoft, true: COLORS.active }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={COLORS.inactiveSoft}
            accessibilityLabel={`Alternar sensor ${sensor.codigo}`}
          />
        )}
      </View>
    </View>
  );
});

/* -------------------------------------------------------------------------- */
/* Tela principal                                                              */
/* -------------------------------------------------------------------------- */

export default function SensorDashboard() {
  const [sensors, setSensors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [pendingCodes, setPendingCodes] = useState([]);
  const [actionError, setActionError] = useState(null);

  const loadSensors = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const json = await request(LIST_PATH);
      setSensors((json.data || []).map(toSensor));
    } catch (e) {
      setError(
        'Não foi possível carregar os sensores. Verifique se o celular está na mesma rede do servidor e tente de novo.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSensors();
  }, [loadSensors]);

  const setSensorState = (codigo, ativo) =>
    setSensors((prev) => prev.map((s) => (s.codigo === codigo ? { ...s, ativo } : s)));

  const handleToggle = useCallback(async (sensor) => {
    const novoStatus = !sensor.ativo;
    setActionError(null);

    // Atualização otimista: a interface muda na hora.
    setSensorState(sensor.codigo, novoStatus);
    setPendingCodes((prev) => [...prev, sensor.codigo]);

    try {
      const result = await request(UPDATE_PATH, {
        method: 'PUT',
        body: JSON.stringify({ codigo: sensor.codigo, status: novoStatus }),
      });

      if (!result.status) {
        throw new Error(result.message);
      }
    } catch (e) {
      // Se o backend falhar, desfazemos a mudança na interface.
      setSensorState(sensor.codigo, sensor.ativo);
      setActionError(`Não foi possível atualizar o sensor ${sensor.codigo}. Tente novamente.`);
    } finally {
      setPendingCodes((prev) => prev.filter((c) => c !== sensor.codigo));
    }
  }, []);

  const activeCount = sensors.filter((s) => s.ativo).length;

  /* ------------------------------- Estados ------------------------------- */

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={COLORS.ink} />
        <Text style={styles.helper}>Buscando sensores…</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.inactive} />
        <Text style={styles.errorTitle}>Sem conexão com o servidor</Text>
        <Text style={styles.helper}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadSensors()}
          activeOpacity={0.8}
        >
          <Text style={styles.retryText}>Tentar novamente</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  /* ------------------------------- Lista --------------------------------- */

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.paper} />

      <View style={styles.header}>
        <Text style={styles.title}>Sensores</Text>
        <Text style={styles.subtitle}>
          {sensors.length === 0
            ? 'Nenhum sensor cadastrado'
            : `${activeCount} de ${sensors.length} ativos`}
        </Text>
      </View>

      {actionError && (
        <View style={styles.banner}>
          <Ionicons name="alert-circle-outline" size={18} color={COLORS.danger} />
          <Text style={styles.bannerText}>{actionError}</Text>
        </View>
      )}

      <FlatList
        data={sensors}
        keyExtractor={(item) => item.codigo}
        renderItem={({ item }) => (
          <SensorCard
            sensor={item}
            pending={pendingCodes.includes(item.codigo)}
            onToggle={handleToggle}
          />
        )}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadSensors(true)}
            tintColor={COLORS.ink}
            colors={[COLORS.ink]}
          />
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Ionicons name="hardware-chip-outline" size={48} color={COLORS.inactive} />
            <Text style={styles.helper}>Puxe a lista para baixo para atualizar.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* Estilos                                                                     */
/* -------------------------------------------------------------------------- */

const COLORS = {
  paper: '#F3F5F2',
  card: '#FFFFFF',
  ink: '#16302B',
  muted: '#66736F',
  active: '#1E9E6F',
  activeSoft: '#DDF3EA',
  inactive: '#8A9591',
  inactiveSoft: '#E3E7E4',
  danger: '#B3372D',
  dangerSoft: '#FBE7E4',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.paper,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 15,
    color: COLORS.muted,
  },

  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    flexGrow: 1,
  },
  separator: {
    height: 10,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderLeftWidth: 5,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 14,
  },
  code: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.ink,
  },
  type: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  action: {
    minWidth: 52,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.dangerSoft,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.danger,
  },

  helper: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.muted,
    textAlign: 'center',
  },
  errorTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.ink,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: COLORS.ink,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});