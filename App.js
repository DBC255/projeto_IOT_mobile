import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Switch,
  TextInput,
  Text,
  View,
} from 'react-native';

type SensorStatus = boolean | number;

type Sensor = {
  codigo: string;
  tipo: string;
  status: SensorStatus;
};

type SensorDashboardProps = {
  /** Endereço da API. Pode ser sobrescrito conforme o ambiente (emulador/dispositivo). */
  apiBaseUrl?: string;
};

// Endpoints confirmados nas capturas do Insomnia anexadas pelo usuário.
const DEFAULT_API_BASE_URL = 'http://10.137.11.6/';
const SENSOR_LIST_PATH = '/api/sensor/status/listar';
const SENSOR_VIEW_PATH = '/api/sensor/status/visualizar';
const SENSOR_UPDATE_PATH = '/api/sensor/status/atualizar';

function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function isActive(status: SensorStatus): boolean {
  if (typeof status === 'boolean') return status;
  return Number(status) !== 0 && Number.isFinite(Number(status));
}

function readSensorList(payload: unknown): Sensor[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error('A resposta da API não contém uma lista válida de sensores.');
  }

  return data.map((item, index) => {
    const sensor = item as Partial<Sensor>;
    if (typeof sensor.codigo !== 'string' || typeof sensor.tipo !== 'string') {
      throw new Error(`Os dados do sensor ${index + 1} estão incompletos.`);
    }
    if (typeof sensor.status !== 'boolean' && typeof sensor.status !== 'number') {
      throw new Error(`O status do sensor ${sensor.codigo} está incompleto.`);
    }
    return {
      codigo: sensor.codigo,
      tipo: sensor.tipo,
      status: sensor.status,
    };
  });
}

export default function SensorDashboard({
  apiBaseUrl = DEFAULT_API_BASE_URL,
}: SensorDashboardProps) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingCodes, setUpdatingCodes] = useState<string[]>([]);
  const [checkingCodes, setCheckingCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSensors = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('pt-BR');
    if (!query) return sensors;

    return sensors.filter((sensor) =>
      sensor.codigo.toLocaleLowerCase('pt-BR') === query ||
      sensor.tipo.toLocaleLowerCase('pt-BR').includes(query),
    );
  }, [searchTerm, sensors]);

  const loadSensors = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        apiEndpoint(apiBaseUrl, SENSOR_LIST_PATH),
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }
      const payload: unknown = await response.json();
      setSensors(readSensorList(payload));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível carregar os sensores. ${err.message}`
          : 'Não foi possível carregar os sensores. Verifique a conexão com a API.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void loadSensors();
  }, [loadSensors]);

  const refreshSensorStatus = async (sensor: Sensor) => {
    if (checkingCodes.includes(sensor.codigo)) return;
    setCheckingCodes((current) => [...current, sensor.codigo]);
    setError(null);

    try {
      const code = encodeURIComponent(sensor.codigo.toLowerCase());
      const response = await fetch(
        `${apiEndpoint(apiBaseUrl, SENSOR_VIEW_PATH)}/${code}`,
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }

      const result = (await response.json()) as { status?: SensorStatus };
      if (typeof result.status !== 'boolean' && typeof result.status !== 'number') {
        throw new Error('A resposta não contém um status válido.');
      }

      setSensors((current) =>
        current.map((item) =>
          item.codigo === sensor.codigo ? { ...item, status: result.status! } : item,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível consultar ${sensor.codigo}. ${err.message}`
          : `Não foi possível consultar ${sensor.codigo}. Verifique a conexão com a API.`,
      );
    } finally {
      setCheckingCodes((current) => current.filter((code) => code !== sensor.codigo));
    }
  };

  const toggleSensor = async (sensor: Sensor) => {
    const previousStatus = sensor.status;
    const nextStatus = !isActive(previousStatus);

    // Atualização otimista: a interface responde imediatamente; em caso de falha, reverte.
    setSensors((current) =>
      current.map((item) =>
        item.codigo === sensor.codigo ? { ...item, status: nextStatus } : item,
      ),
    );
    setUpdatingCodes((current) => [...current, sensor.codigo]);
    setError(null);

    try {
      const response = await fetch(
        apiEndpoint(apiBaseUrl, SENSOR_UPDATE_PATH),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // O backend mostrado no Insomnia recebe o código em letras minúsculas.
          body: JSON.stringify({ codigo: sensor.codigo.toLowerCase(), status: nextStatus }),
        },
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }

      // Alguns backends devolvem o estado atualizado no campo "status".
      const result = (await response.json()) as { status?: SensorStatus };
      if (result.status !== undefined) {
        setSensors((current) =>
          current.map((item) =>
            item.codigo === sensor.codigo ? { ...item, status: result.status! } : item,
          ),
        );
      }
    } catch (err) {
      setSensors((current) =>
        current.map((item) =>
          item.codigo === sensor.codigo ? { ...item, status: previousStatus } : item,
        ),
      );
      setError(
        err instanceof Error
          ? `Não foi possível atualizar ${sensor.codigo}. ${err.message}`
          : `Não foi possível atualizar ${sensor.codigo}. Tente novamente.`,
      );
    } finally {
      setUpdatingCodes((current) => current.filter((code) => code !== sensor.codigo));
    }
  };

  const renderSensor = ({ item }: { item: Sensor }) => {
    const active = isActive(item.status);
    const updating = updatingCodes.includes(item.codigo);
    const checking = checkingCodes.includes(item.codigo);

    return (
      <View style={styles.card}>
        <View style={styles.sensorInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.sensorCode}>{item.codigo}</Text>
            <View style={[styles.statusBadge, active ? styles.activeBadge : styles.inactiveBadge]}>
              <View style={[styles.statusDot, active ? styles.activeDot : styles.inactiveDot]} />
              <Text style={[styles.statusText, active ? styles.activeText : styles.inactiveText]}>
                {active ? 'Ativo' : 'Inativo'}
              </Text>
            </View>
          </View>
          <Text style={styles.sensorType}>{item.tipo}</Text>
        </View>
        <View style={styles.control}>
          {updating ? (
            <ActivityIndicator size="small" color="#2563EB" />
          ) : (
            <Switch
              accessibilityLabel={`Alternar sensor ${item.codigo}`}
              value={active}
              onValueChange={() => void toggleSensor(item)}
              trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
              thumbColor={active ? '#2563EB' : '#F8FAFC'}
            />
          )}
          <Text style={styles.controlLabel}>{active ? 'Desligar' : 'Ligar'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Consultar status de ${item.codigo}`}
            disabled={checking}
            onPress={() => void refreshSensorStatus(item)}
            style={styles.queryButton}
          >
            {checking ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Text style={styles.queryButtonText}>Verificar</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>MONITORAMENTO</Text>
          <Text style={styles.heading}>Sensores</Text>
          <Text style={styles.subtitle}>Acompanhe e controle o status dos dispositivos.</Text>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            accessibilityLabel="Buscar sensor por código ou tipo"
            placeholder="Buscar por código ou tipo"
            placeholderTextColor="#94A3B8"
            value={searchTerm}
            onChangeText={setSearchTerm}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchTerm.length > 0 ? (
            <Pressable
              onPress={() => setSearchTerm('')}
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
              hitSlop={8}
            >
              <Text style={styles.clearSearch}>Limpar</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadSensors()} accessibilityRole="button">
              <Text style={styles.retryText}>Tentar novamente</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={styles.loadingText}>Carregando sensores...</Text>
          </View>
        ) : (
          <FlatList
            data={filteredSensors}
            keyExtractor={(item) => item.codigo}
            renderItem={renderSensor}
            contentContainerStyle={filteredSensors.length === 0 ? styles.emptyList : styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void loadSensors(true)} />
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searchTerm.trim()
                  ? 'Nenhum sensor corresponde à busca.'
                  : 'Nenhum sensor encontrado.'}
              </Text>
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F7FB' },
  container: { flex: 1, paddingHorizontal: 20 },
  header: { paddingTop: 28, paddingBottom: 22 },
  eyebrow: { color: '#2563EB', fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  heading: { color: '#0F172A', fontSize: 32, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#64748B', fontSize: 14, marginTop: 7 },
  searchBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 14,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  searchIcon: { color: '#64748B', fontSize: 22, marginRight: 9 },
  searchInput: { color: '#0F172A', flex: 1, fontSize: 14, paddingVertical: 11 },
  clearSearch: { color: '#2563EB', fontSize: 12, fontWeight: '700', paddingLeft: 8 },
  list: { paddingBottom: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E8EDF4',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    minHeight: 104,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sensorInfo: { flex: 1, paddingRight: 10 },
  titleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sensorCode: { color: '#0F172A', fontSize: 18, fontWeight: '700' },
  sensorType: { color: '#475569', fontSize: 14, marginTop: 7, textTransform: 'capitalize' },
  statusBadge: { alignItems: 'center', borderRadius: 20, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 5 },
  activeBadge: { backgroundColor: '#DCFCE7' },
  inactiveBadge: { backgroundColor: '#F1F5F9' },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  activeDot: { backgroundColor: '#16A34A' },
  inactiveDot: { backgroundColor: '#94A3B8' },
  statusText: { fontSize: 11, fontWeight: '700' },
  activeText: { color: '#15803D' },
  inactiveText: { color: '#64748B' },
  control: { alignItems: 'center', minWidth: 65 },
  controlLabel: { color: '#64748B', fontSize: 11, marginTop: 3 },
  queryButton: { alignItems: 'center', justifyContent: 'center', marginTop: 7, minHeight: 28, minWidth: 62 },
  queryButtonText: { color: '#2563EB', fontSize: 11, fontWeight: '700' },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 12 },
  loadingText: { color: '#64748B', fontSize: 14 },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: 12, marginBottom: 16, padding: 14 },
  errorText: { color: '#B91C1C', fontSize: 13, lineHeight: 19 },
  retryText: { color: '#1D4ED8', fontSize: 13, fontWeight: '700', marginTop: 9 },
  emptyText: { color: '#64748B', fontSize: 14 },
});
