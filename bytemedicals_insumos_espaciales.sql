-- ============================================================================
-- ByteMedicals - Insumos médicos para el espacio
-- Catálogo de insumos médicos espaciales (bytemedicals_db) - MySQL 8 / MariaDB
-- ============================================================================
-- ByteMedicals: catálogo de insumos médicos para el espacio.
--  * Misión simulada de 180 días: telemetría (hr, spo2, temp, rad),
--    alertas y registro de medicamentos e insumos.
--  * Entornos de misión: 6 entornos (estación, nave, superficie lunar,
--    superficie marciana, rover, hábitat).
--  * La radiación, la microgravedad, el aislamiento y la distancia son
--    el contexto que justifica por qué un insumo "normal" NO sirve en
--    el espacio.
--
-- Qué resuelve este archivo:
--  * Catálogo de insumos con criterios espaciales: sin vidrio, empaque
--    sellado, masa/volumen, temperatura, tolerancia a radiación y rango
--    de gravedad en el que se puede almacenar y usar.
--  * Inventario por misión, por lote y por ubicación de almacenamiento.
--  * Trazabilidad de uso/administración vinculada a missions + día de
--    misión (0-180), como los registros de medicamentos (taken / missed).
--  * Alertas de stock bajo y de caducidad, y vistas por entorno.
--
-- Uso:
--   mysql -u root -p < bytemedicals_insumos_espaciales.sql
--   -- o importar este archivo después de crear bytemedicals_db.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS bytemedicals_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bytemedicals_db;

-- ============================================================================
-- 1. Entornos de misión
--    gravity_g es el valor de referencia, no un dato médico.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mission_environments (
  environment_id VARCHAR(32) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  destination VARCHAR(32) NOT NULL,
  gravity_g DECIMAL(5,3) NOT NULL,
  gravity_text VARCHAR(80) NOT NULL,
  distance_text VARCHAR(120),
  comms_delay VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mission_environments
  (environment_id, label, destination, gravity_g, gravity_text, distance_text, comms_delay)
VALUES
  ('station', 'Space Station (ISS-like)', 'earth', 0.000, '~0 g - microgravity', '≈ 408 km above Earth', '~0 s'),
  ('spacecraft', 'Spacecraft - transit', 'mars', 0.000, '~0 g - microgravity', 'Earth-Mars, varies', 'up to ~22 min one-way'),
  ('lunar-surface', 'Lunar surface', 'moon', 0.166, '0.166 g - 1.62 m/s2', '384,400 km from Earth', '~1.3 s one-way'),
  ('mars-surface', 'Martian surface', 'mars', 0.380, '0.38 g - 3.71 m/s2', '≈ 225 M km from Earth (varies)', 'up to ~22 min one-way'),
  ('rover', 'Explorer vehicle - rover (Mars)', 'mars', 0.380, '0.38 g - 3.71 m/s2', '≈ 225 M km from Earth (varies)', 'up to ~22 min one-way'),
  ('habitat', 'Space habitat (cislunar)', 'moon', 0.000, '~0 g - microgravity', '≈ 384,400 km from Earth', '~1.3 s one-way')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), gravity_g = VALUES(gravity_g);

-- ============================================================================
-- 2. Catálogo
-- ============================================================================
CREATE TABLE IF NOT EXISTS supply_categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255),
  nasa_hazard VARCHAR(80) NULL COMMENT 'Peligro NASA relacionado: Radiation, Gravity Fields, Isolation, Distance, Hostile/Closed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO supply_categories (name, description, nasa_hazard) VALUES
  ('Analgesicos y antipireticos', 'Dolor y fiebre en mision', 'Gravity Fields'),
  ('Antibioticos', 'Infecciones bacterianas', 'Hostile / Closed Environments'),
  ('Antiemeticos y mareo espacial', 'Nausea y mareo por adaptacion espacial', 'Gravity Fields'),
  ('Emergencia', 'Anafilaxia, paro, trauma grave', 'Distance from Earth'),
  ('Curacion y trauma', 'Heridas, vendajes, sutura', 'Hostile / Closed Environments'),
  ('Diagnostico', 'Equipos de medicion no invasiva', 'Gravity Fields'),
  ('Hidratacion y electrolitos', 'Rehidratacion oral e IV', 'Gravity Fields'),
  ('Sueno y salud mental', 'Sueno, estres y adaptacion conductual', 'Isolation and Confinement'),
  ('Proteccion radiologica y soporte', 'Soporte asociado a exposicion acumulada', 'Space Radiation')
ON DUPLICATE KEY UPDATE description = VALUES(description);

CREATE TABLE IF NOT EXISTS medical_supplies (
  supply_id VARCHAR(32) PRIMARY KEY COMMENT 'SKU interno, ej. MED-IBU-200',
  name VARCHAR(160) NOT NULL,
  generic_name VARCHAR(160),
  category_id INT NOT NULL,
  supply_type ENUM('medicamento','equipo','consumible','diagnostico','kit') NOT NULL,
  -- Forma y empaque espacial: nunca vidrio suelto, nunca liquido abierto en 0 g
  form VARCHAR(80) NOT NULL COMMENT 'tableta blister, capsula, parche, bolsa presurizada, etc.',
  packaging VARCHAR(80) NOT NULL DEFAULT 'blister sellado',
  unit VARCHAR(30) NOT NULL DEFAULT 'unidad',
  dose_standard VARCHAR(80) NULL COMMENT 'Dosis de referencia del catalogo, no prescripcion',
  mass_g DECIMAL(8,2) NOT NULL COMMENT 'Masa por unidad, para presupuesto de masa de la mision',
  volume_cm3 DECIMAL(8,2) NOT NULL COMMENT 'Volumen por unidad',
  requires_cold_chain TINYINT(1) NOT NULL DEFAULT 0,
  temp_min_c DECIMAL(4,1) NULL,
  temp_max_c DECIMAL(4,1) NULL,
  -- Criterios espaciales
  space_approved TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = apto para almacenar y usar en el espacio segun este catalogo',
  gravity_min_g DECIMAL(5,3) NOT NULL DEFAULT 0.000,
  gravity_max_g DECIMAL(5,3) NOT NULL DEFAULT 1.000 COMMENT 'Rango de gravedad en el que se puede usar',
  radiation_tolerant TINYINT(1) NOT NULL DEFAULT 0,
  radiation_limit_msv DECIMAL(8,2) NULL COMMENT 'Dosis acumulada tolerada sin degradacion segun ficha',
  shelf_life_days INT NOT NULL DEFAULT 365,
  requires_training VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_supply_category FOREIGN KEY (category_id)
    REFERENCES supply_categories (category_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_gravity_range CHECK (gravity_min_g <= gravity_max_g),
  CONSTRAINT chk_mass_positive CHECK (mass_g > 0),
  INDEX idx_supply_category (category_id),
  INDEX idx_supply_space (space_approved, gravity_min_g, gravity_max_g)
);

-- Catálogo inicial: todos con empaque espacial, sin vidrio
INSERT INTO medical_supplies
  (supply_id, name, generic_name, category_id, supply_type, form, packaging, unit, dose_standard, mass_g, volume_cm3, requires_cold_chain, temp_min_c, temp_max_c, space_approved, gravity_min_g, gravity_max_g, radiation_tolerant, radiation_limit_msv, shelf_life_days, requires_training, notes)
VALUES
  ('MED-IBU-200', 'Ibuprofeno 200 mg', 'Ibuprofeno', 1, 'medicamento', 'tableta en blister', 'blister sellado al vacio', 'tableta', '200 mg', 0.60, 1.2, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Analgesico de uso general. Blister individual para evitar polvo en microgravedad.'),
  ('MED-PAR-500', 'Paracetamol 500 mg', 'Paracetamol', 1, 'medicamento', 'tableta en blister', 'blister sellado al vacio', 'tableta', '500 mg', 0.70, 1.2, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Antipiretico. Alternativa cuando el ibuprofeno no es adecuado.'),
  ('MED-AMX-500', 'Amoxicilina 500 mg', 'Amoxicilina', 2, 'medicamento', 'capsula en blister', 'blister sellado al vacio', 'capsula', '500 mg', 0.80, 1.5, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 500.00, 540, 'Uso bajo protocolo de mision', 'Antibiotico de amplio espectro del botiquin. No es automedicacion.'),
  ('MED-OND-4', 'Ondansetron 4 mg', 'Ondansetron', 3, 'medicamento', 'tableta sublingual', 'blister sellado', 'tableta', '4 mg', 0.40, 1.0, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 540, NULL, 'Antiemetico. Util en adaptacion espacial y nauseas. Sublingual, sin agua.'),
  ('MED-MEC-25', 'Meclizina 25 mg', 'Meclizina', 3, 'medicamento', 'tableta en blister', 'blister sellado', 'tableta', '25 mg', 0.50, 1.0, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Mareo espacial y vertigo. Clasico del botiquin de vuelo.'),
  ('MED-EPI-03', 'Epinefrina autoinyector 0.3 mg', 'Epinefrina', 4, 'medicamento', 'autoinyector sellado', 'contenedor rigido sin vidrio', 'autoinyector', '0.3 mg / dosis', 120.00, 90.0, 0, 15.0, 25.0, 1, 0.000, 1.000, 0, 200.00, 365, 'Entrenamiento de emergencia', 'Emergencia por anafilaxia. Contenedor rigido, sin vidrio expuesto. Revisar caducidad con prioridad.'),
  ('MED-SAL-250', 'Solucion salina 0.9% 250 ml', 'Cloruro de sodio 0.9%', 7, 'medicamento', 'bolsa presurizada', 'bolsa presurizada sellada', 'bolsa', '250 ml', 270.00, 280.0, 0, 15.0, 25.0, 1, 0.000, 0.380, 1, 600.00, 365, 'Entrenamiento IV en microgravedad', 'Bolsa presurizada para uso en 0 g. No usar bolsa por gravedad en microgravedad.'),
  ('MED-ORS-01', 'Sales de rehidratacion oral', 'SRO', 7, 'medicamento', 'polvo en sobre sellado', 'sobre sellado al vacio', 'sobre', '1 sobre / 200 ml', 22.00, 30.0, 0, 15.0, 30.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Polvo sellado, se reconstituye con agua de la nave. Sin derrames.'),
  ('MED-MEL-3', 'Melatonina 3 mg', 'Melatonina', 8, 'medicamento', 'tableta en blister', 'blister sellado', 'tableta', '3 mg', 0.30, 1.0, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 540, NULL, 'Apoyo al sueno en mision. Registro sin cambiar pauta.'),
  ('MED-LOR-10', 'Loratadina 10 mg', 'Loratadina', 2, 'medicamento', 'tableta en blister', 'blister sellado', 'tableta', '10 mg', 0.40, 1.0, 0, 15.0, 25.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Antihistaminico no sedante.'),
  ('EQP-OXI-01', 'Oximetro de pulso compacto', NULL, 6, 'equipo', 'dispositivo sellado', 'contenedor rigido', 'equipo', NULL, 45.00, 65.0, 0, 0.0, 40.0, 1, 0.000, 1.000, 1, 1000.00, 1095, NULL, 'Mide SpO2, senal de ByteMedicals. Bateria recargable, sin partes sueltas.'),
  ('EQP-TEN-01', 'Tensiometro automatico de muneca', NULL, 6, 'equipo', 'dispositivo sellado', 'contenedor rigido', 'equipo', NULL, 180.00, 220.0, 0, 10.0, 35.0, 1, 0.000, 0.380, 1, 600.00, 1095, NULL, 'PA de Clinical Signals. Validado para 0 g y superficie.'),
  ('CON-VEN-01', 'Vendaje compresivo esteril', NULL, 5, 'consumible', 'rollo sellado al vacio', 'empaque al vacio', 'vendaje', NULL, 35.00, 45.0, 0, 10.0, 30.0, 1, 0.000, 1.000, 1, 600.00, 1095, NULL, 'Curacion. Empaque al vacio, apertura controlada en microgravedad.'),
  ('CON-GUA-N', 'Guantes de nitrilo (par)', NULL, 5, 'consumible', 'par en bolsa sellada', 'bolsa sellada', 'par', NULL, 12.00, 20.0, 0, 10.0, 30.0, 1, 0.000, 1.000, 1, 600.00, 730, NULL, 'Higiene y curacion. Sin latex.'),
  ('KIT-SUT-01', 'Kit de sutura menor esteril', NULL, 5, 'kit', 'kit sellado', 'contenedor rigido sellado', 'kit', NULL, 220.00, 320.0, 0, 10.0, 30.0, 1, 0.000, 1.000, 0, 300.00, 540, 'Entrenamiento de cirujano de vuelo', 'Solo bajo protocolo y supervision de cirujano de vuelo.'),
  ('EQP-TER-IR', 'Termometro infrarrojo sin contacto', NULL, 6, 'equipo', 'dispositivo sellado', 'contenedor rigido', 'equipo', NULL, 90.00, 110.0, 0, 10.0, 40.0, 1, 0.000, 1.000, 1, 600.00, 1095, NULL, 'Temperatura corporal, senal de ByteMedicals. Sin mercurio, sin vidrio.')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================================================
-- 3. Calificación espacial (evidencia, no solo un flag)
--    Cada insumo puede tener varias pruebas: radiacion, vibracion,
--    microgravedad, almacenamiento prolongado, etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS supply_space_qualification (
  qualification_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supply_id VARCHAR(32) NOT NULL,
  test_type VARCHAR(80) NOT NULL COMMENT 'radiacion, microgravedad, vibracion, vacio, almacenamiento, etc.',
  result ENUM('aprobado','condicional','no_aprobado','pendiente') NOT NULL DEFAULT 'pendiente',
  tested_gravity_g DECIMAL(5,3) NULL,
  dose_msv DECIMAL(8,2) NULL,
  notes TEXT NULL,
  tested_at DATE NULL,
  source VARCHAR(255) NULL COMMENT 'Fuente: NASA HRP, CSA, fabricante, estudio interno',
  CONSTRAINT fk_qual_supply FOREIGN KEY (supply_id)
    REFERENCES medical_supplies (supply_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_qual_supply (supply_id, test_type)
);

INSERT INTO supply_space_qualification (supply_id, test_type, result, tested_gravity_g, dose_msv, notes, tested_at, source) VALUES
  ('MED-IBU-200', 'microgravedad', 'aprobado', 0.000, NULL, 'Blister sellado, sin polvo libre en 0 g.', '2026-01-15', 'Ficha de catalogo ByteMedicals'),
  ('MED-IBU-200', 'radiacion', 'aprobado', NULL, 600.00, 'Estable hasta 600 mSv acumulados.', '2026-01-15', 'Ficha de catalogo ByteMedicals'),
  ('MED-EPI-03', 'microgravedad', 'condicional', 0.000, NULL, 'Requiere contenedor rigido y revision de caducidad prioritaria.', '2026-02-01', 'Ficha de catalogo ByteMedicals'),
  ('MED-SAL-250', 'microgravedad', 'aprobado', 0.000, NULL, 'Bolsa presurizada validada para 0 g. No usar por gravedad.', '2026-02-01', 'Ficha de catalogo ByteMedicals'),
  ('EQP-OXI-01', 'vibracion', 'aprobado', NULL, NULL, 'Resiste vibracion de lanzamiento en contenedor.', '2026-02-10', 'Ficha de catalogo ByteMedicals');

-- ============================================================================
-- 4. Ubicaciones de almacenamiento
--    Una ubicación pertenece a un entorno y a una misión (o es genérica).
-- ============================================================================
-- Compatibilidad: la tabla missions se crea aquí si no existe, para
-- que las FK no fallen. Si ya existe, no se toca.
CREATE TABLE IF NOT EXISTS missions (
  mission_id VARCHAR(64) PRIMARY KEY,
  crew_name VARCHAR(120),
  current_day INT NOT NULL DEFAULT 0,
  mode VARCHAR(32) NOT NULL DEFAULT 'simulation',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storage_locations (
  location_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  environment_id VARCHAR(32) NOT NULL,
  mission_id VARCHAR(64) NULL COMMENT 'NULL = ubicacion plantilla, no de una mision concreta',
  temp_c DECIMAL(4,1) NULL,
  radiation_shielding VARCHAR(40) NULL COMMENT 'baja / media / alta',
  capacity_units INT NOT NULL DEFAULT 100,
  notes VARCHAR(255) NULL,
  CONSTRAINT fk_location_env FOREIGN KEY (environment_id)
    REFERENCES mission_environments (environment_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_location_mission FOREIGN KEY (mission_id)
    REFERENCES missions (mission_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_location_env (environment_id)
);

-- Nota: si missions aún no tiene la misión de ejemplo, se crea abajo
-- antes de insertar ubicaciones con mission_id. Las plantillas van primero.
INSERT INTO storage_locations (location_id, name, environment_id, mission_id, temp_c, radiation_shielding, capacity_units, notes) VALUES
  ('LOC-ISS-MEDBAY', 'ISS Medical Bay', 'station', NULL, 22.0, 'media', 200, 'Botiquin principal en estacion.'),
  ('LOC-TRANS-LOCKA', 'Transit Locker A', 'spacecraft', NULL, 22.0, 'baja', 120, 'Locker de transito, acceso rapido.'),
  ('LOC-LUNAR-MED', 'Lunar Habitat Med Bay', 'lunar-surface', NULL, 22.0, 'alta', 200, 'Bahia medica lunar con blindaje.'),
  ('LOC-MARS-MED', 'Mars Habitat Med Bay', 'mars-surface', NULL, 21.0, 'alta', 200, 'Bahia medica marciana.')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ============================================================================
-- 5. Lotes (trazabilidad: lote + caducidad + exposición a radiación)
-- ============================================================================
CREATE TABLE IF NOT EXISTS supply_batches (
  batch_id VARCHAR(40) PRIMARY KEY,
  supply_id VARCHAR(32) NOT NULL,
  lot_number VARCHAR(60) NOT NULL,
  manufactured_date DATE NULL,
  expiration_date DATE NOT NULL,
  quantity_initial INT NOT NULL,
  radiation_exposure_msv DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_batch_supply FOREIGN KEY (supply_id)
    REFERENCES medical_supplies (supply_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_qty_initial CHECK (quantity_initial >= 0),
  CONSTRAINT uq_batch_lot UNIQUE (supply_id, lot_number),
  INDEX idx_batch_exp (expiration_date),
  INDEX idx_batch_supply (supply_id)
);

INSERT INTO supply_batches (batch_id, supply_id, lot_number, manufactured_date, expiration_date, quantity_initial, radiation_exposure_msv) VALUES
  ('B-IBU-2026-01', 'MED-IBU-200', 'IBU26A', '2026-01-10', '2028-01-10', 200, 0.00),
  ('B-PAR-2026-01', 'MED-PAR-500', 'PAR26A', '2026-01-10', '2028-01-10', 200, 0.00),
  ('B-OND-2026-01', 'MED-OND-4', 'OND26A', '2026-01-10', '2027-07-10', 120, 0.00),
  ('B-EPI-2026-01', 'MED-EPI-03', 'EPI26A', '2026-01-05', '2027-01-05', 6, 0.00),
  ('B-SAL-2026-01', 'MED-SAL-250', 'SAL26A', '2026-01-08', '2027-01-08', 20, 0.00),
  ('B-OXI-2026-01', 'EQP-OXI-01', 'OXI26A', '2026-01-01', '2029-01-01', 4, 0.00)
ON DUPLICATE KEY UPDATE expiration_date = VALUES(expiration_date);

-- ============================================================================
-- 6. Inventario por misión
--    Esta es la tabla que conecta ByteMedicals con el almacén: una misión tiene
--    un entorno, un día (0-180) y un stock real.
-- ============================================================================
-- Misión de ejemplo (si ya existe, no se duplica)
INSERT INTO missions (mission_id, crew_name, current_day, mode)
VALUES ('MISION-DEMO-180', 'Crew Demo - ByteMedicals', 42, 'simulation')
ON DUPLICATE KEY UPDATE crew_name = VALUES(crew_name);

CREATE TABLE IF NOT EXISTS mission_inventory (
  inventory_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  supply_id VARCHAR(32) NOT NULL,
  batch_id VARCHAR(40) NOT NULL,
  location_id VARCHAR(32) NOT NULL,
  quantity_on_hand INT NOT NULL DEFAULT 0,
  quantity_reserved INT NOT NULL DEFAULT 0,
  reorder_threshold INT NOT NULL DEFAULT 10 COMMENT 'Si quantity_on_hand <= threshold, hay que reponer',
  status ENUM('disponible','bajo','agotado','caducado','en_cuarentena') NOT NULL DEFAULT 'disponible',
  last_checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_mission FOREIGN KEY (mission_id)
    REFERENCES missions (mission_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_inv_supply FOREIGN KEY (supply_id)
    REFERENCES medical_supplies (supply_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_inv_batch FOREIGN KEY (batch_id)
    REFERENCES supply_batches (batch_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_inv_location FOREIGN KEY (location_id)
    REFERENCES storage_locations (location_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_qty_hand CHECK (quantity_on_hand >= 0),
  CONSTRAINT uq_inv_mission_batch_loc UNIQUE (mission_id, batch_id, location_id),
  INDEX idx_inv_mission (mission_id, status),
  INDEX idx_inv_supply (supply_id)
);

INSERT INTO mission_inventory (mission_id, supply_id, batch_id, location_id, quantity_on_hand, quantity_reserved, reorder_threshold, status) VALUES
  ('MISION-DEMO-180', 'MED-IBU-200', 'B-IBU-2026-01', 'LOC-ISS-MEDBAY', 120, 10, 20, 'disponible'),
  ('MISION-DEMO-180', 'MED-PAR-500', 'B-PAR-2026-01', 'LOC-ISS-MEDBAY', 90, 0, 20, 'disponible'),
  ('MISION-DEMO-180', 'MED-OND-4', 'B-OND-2026-01', 'LOC-ISS-MEDBAY', 48, 0, 10, 'disponible'),
  ('MISION-DEMO-180', 'MED-EPI-03', 'B-EPI-2026-01', 'LOC-ISS-MEDBAY', 4, 0, 2, 'disponible'),
  ('MISION-DEMO-180', 'MED-SAL-250', 'B-SAL-2026-01', 'LOC-ISS-MEDBAY', 12, 0, 5, 'disponible'),
  ('MISION-DEMO-180', 'EQP-OXI-01', 'B-OXI-2026-01', 'LOC-ISS-MEDBAY', 3, 0, 1, 'disponible');

-- ============================================================================
-- 7. Administración / consumo
--    Equivale al registro de medicamento (taken / missed), pero con lote,
--    dosis, vía y tripulante. Nunca recomienda ni cambia una dosis:
--    solo registra lo que se administró según protocolo de misión.
-- ============================================================================
CREATE TABLE IF NOT EXISTS supply_administrations (
  administration_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  mission_day INT NOT NULL COMMENT 'Día de misión 0-180, como en ByteMedicals',
  crew_member VARCHAR(120) NOT NULL,
  supply_id VARCHAR(32) NOT NULL,
  batch_id VARCHAR(40) NULL,
  inventory_id BIGINT NULL,
  dose_amount DECIMAL(8,2) NULL,
  dose_unit VARCHAR(20) NULL,
  route VARCHAR(40) NULL COMMENT 'oral, sublingual, IV, topica, inhalada, etc.',
  scheduled_time TIME NULL,
  status ENUM('taken','missed','skipped','administered','wasted','damaged') NOT NULL DEFAULT 'taken',
  administered_by VARCHAR(120) NULL COMMENT 'Tripulante o cirujano de vuelo',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_mission FOREIGN KEY (mission_id)
    REFERENCES missions (mission_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_admin_supply FOREIGN KEY (supply_id)
    REFERENCES medical_supplies (supply_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_admin_batch FOREIGN KEY (batch_id)
    REFERENCES supply_batches (batch_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_admin_inventory FOREIGN KEY (inventory_id)
    REFERENCES mission_inventory (inventory_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_day_range CHECK (mission_day BETWEEN 0 AND 180),
  INDEX idx_admin_mission_day (mission_id, mission_day),
  INDEX idx_admin_supply (supply_id, status)
);

INSERT INTO supply_administrations
  (mission_id, mission_day, crew_member, supply_id, batch_id, dose_amount, dose_unit, route, scheduled_time, status, administered_by, notes)
VALUES
  ('MISION-DEMO-180', 42, 'Crew Demo - ByteMedicals', 'MED-IBU-200', 'B-IBU-2026-01', 200, 'mg', 'oral', '08:00:00', 'taken', 'Crew Demo - ByteMedicals', 'Ejemplo: dosis registrada en Medicamentos, día 42.'),
  ('MISION-DEMO-180', 42, 'Crew Demo - ByteMedicals', 'MED-OND-4', 'B-OND-2026-01', 4, 'mg', 'sublingual', '08:00:00', 'taken', 'Crew Demo - ByteMedicals', 'Ejemplo: antiemetico en adaptacion.'),
  ('MISION-DEMO-180', 43, 'Crew Demo - ByteMedicals', 'MED-IBU-200', 'B-IBU-2026-01', 200, 'mg', 'oral', '08:00:00', 'missed', 'Crew Demo - ByteMedicals', 'Ejemplo: dosis no tomada, queda en el registro como missed.');

-- Log general de uso (consumibles, equipos, desperdicio en microgravedad)
CREATE TABLE IF NOT EXISTS supply_usage_log (
  usage_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mission_id VARCHAR(64) NOT NULL,
  mission_day INT NOT NULL,
  supply_id VARCHAR(32) NOT NULL,
  batch_id VARCHAR(40) NULL,
  quantity_used INT NOT NULL,
  usage_type ENUM('administracion','curacion','diagnostico','mantenimiento','desperdicio','dano_microgravedad','caducado') NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usage_mission FOREIGN KEY (mission_id)
    REFERENCES missions (mission_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_usage_supply FOREIGN KEY (supply_id)
    REFERENCES medical_supplies (supply_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_day_range_usage CHECK (mission_day BETWEEN 0 AND 180),
  INDEX idx_usage_mission_day (mission_id, mission_day)
);

INSERT INTO supply_usage_log (mission_id, mission_day, supply_id, batch_id, quantity_used, usage_type, notes) VALUES
  ('MISION-DEMO-180', 42, 'CON-VEN-01', NULL, 1, 'curacion', 'Ejemplo: vendaje usado en practica de curacion.'),
  ('MISION-DEMO-180', 42, 'CON-GUA-N', NULL, 2, 'curacion', 'Ejemplo: guantes usados.');

-- ============================================================================
-- 8. Vistas útiles para la consola ByteMedicals
-- ============================================================================
CREATE OR REPLACE VIEW v_stock_por_mision AS
SELECT
  mi.mission_id,
  m.crew_name,
  mi.supply_id,
  s.name AS supply_name,
  c.name AS category,
  mi.quantity_on_hand,
  mi.quantity_reserved,
  mi.reorder_threshold,
  mi.status,
  l.name AS location_name,
  b.expiration_date,
  (mi.quantity_on_hand * s.mass_g) AS total_mass_g
FROM mission_inventory mi
JOIN medical_supplies s ON s.supply_id = mi.supply_id
JOIN supply_categories c ON c.category_id = s.category_id
JOIN storage_locations l ON l.location_id = mi.location_id
JOIN supply_batches b ON b.batch_id = mi.batch_id
JOIN missions m ON m.mission_id = mi.mission_id;

CREATE OR REPLACE VIEW v_insumos_por_expirar_30d AS
SELECT
  b.batch_id,
  b.supply_id,
  s.name AS supply_name,
  b.lot_number,
  b.expiration_date,
  DATEDIFF(b.expiration_date, CURDATE()) AS dias_para_caducar,
  mi.mission_id,
  mi.quantity_on_hand
FROM supply_batches b
JOIN medical_supplies s ON s.supply_id = b.supply_id
LEFT JOIN mission_inventory mi ON mi.batch_id = b.batch_id
WHERE b.expiration_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
  AND b.expiration_date >= CURDATE()
ORDER BY b.expiration_date;

CREATE OR REPLACE VIEW v_insumos_aptos_por_entorno AS
SELECT
  e.environment_id,
  e.label AS entorno,
  e.gravity_g,
  s.supply_id,
  s.name AS supply_name,
  s.form,
  s.space_approved
FROM mission_environments e
JOIN medical_supplies s
  ON s.space_approved = 1
  AND e.gravity_g BETWEEN s.gravity_min_g AND s.gravity_max_g
ORDER BY e.environment_id, s.name;

-- ============================================================================
-- 9. Consultas de ejemplo (para probar en el Dashboard / consola)
-- ============================================================================
-- Stock bajo en una misión:
-- SELECT * FROM v_stock_por_mision
-- WHERE mission_id = 'MISION-DEMO-180' AND quantity_on_hand <= reorder_threshold;
--
-- Insumos aptos para superficie marciana (0.38 g):
-- SELECT supply_id, supply_name, form FROM v_insumos_aptos_por_entorno
-- WHERE environment_id = 'mars-surface';
--
-- Insumos aptos para microgravedad (0 g):
-- SELECT supply_id, supply_name, form FROM v_insumos_aptos_por_entorno
-- WHERE environment_id = 'station';
--
-- Administraciones de un día concreto:
-- SELECT * FROM supply_administrations
-- WHERE mission_id = 'MISION-DEMO-180' AND mission_day = 42 ORDER BY scheduled_time;
--
-- Masa total del inventario de una misión (presupuesto de masa):
-- SELECT mission_id, SUM(total_mass_g)/1000 AS masa_total_kg
-- FROM v_stock_por_mision GROUP BY mission_id;
--
-- Caducidad próxima:
-- SELECT * FROM v_insumos_por_expirar_30d;
-- ============================================================================
-- Nota de seguridad (igual que en ByteMedicals):
-- Este esquema registra inventario y administración. No diagnostica,
-- no prescribe y no cambia dosis. La decisión clínica es del
-- cirujano de vuelo y del protocolo de misión.
-- ============================================================================
