-- CreateTable
CREATE TABLE `tienda` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ruc` CHAR(11) NOT NULL,
    `razon_social` VARCHAR(150) NOT NULL,
    `nombre_comercial` VARCHAR(100) NOT NULL,
    `giro_negocio` VARCHAR(60) NOT NULL,
    `direccion` VARCHAR(200) NOT NULL,
    `estado` ENUM('ACTIVA', 'INACTIVA') NOT NULL DEFAULT 'ACTIVA',

    UNIQUE INDEX `tienda_ruc_key`(`ruc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usuario` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tienda_id` BIGINT NULL,
    `username` VARCHAR(40) NOT NULL,
    `password_hash` VARCHAR(60) NOT NULL,
    `nombre` VARCHAR(150) NOT NULL,
    `rol` ENUM('ADMIN_SISTEMA', 'ADMIN_NEGOCIO', 'CLIENTE') NOT NULL,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usuario_username_key`(`username`),
    INDEX `usuario_tienda_id_idx`(`tienda_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bitacora` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `usuario_id` BIGINT NULL,
    `fecha_hora` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accion` VARCHAR(40) NOT NULL,
    `entidad` VARCHAR(40) NOT NULL,
    `entidad_id` BIGINT NULL,
    `detalle_json` JSON NULL,
    `ip` VARCHAR(45) NULL,

    INDEX `bitacora_usuario_id_idx`(`usuario_id`),
    INDEX `bitacora_entidad_entidad_id_idx`(`entidad`, `entidad_id`),
    INDEX `bitacora_fecha_hora_idx`(`fecha_hora`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `parametro` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clave` VARCHAR(40) NOT NULL,
    `moneda` ENUM('PEN', 'USD') NOT NULL,
    `valor` VARCHAR(255) NOT NULL,
    `vigente_desde` DATE NOT NULL,
    `vigente_hasta` DATE NULL,

    UNIQUE INDEX `parametro_clave_moneda_vigente_desde_key`(`clave`, `moneda`, `vigente_desde`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `producto` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tienda_id` BIGINT NOT NULL,
    `codigo` VARCHAR(20) NOT NULL,
    `descripcion` VARCHAR(120) NOT NULL,
    `marca` VARCHAR(60) NULL,
    `proveedor` VARCHAR(100) NULL,
    `unidad_medida` ENUM('UND', 'KG', 'LT', 'PAQ', 'SERVICIO') NOT NULL,
    `imagen_url` VARCHAR(255) NULL,
    `moneda_precio` ENUM('PEN', 'USD') NOT NULL DEFAULT 'PEN',
    `precio_contado` DECIMAL(12, 2) NOT NULL,
    `precio_credito` DECIMAL(12, 2) NULL,
    `permite_credito` BOOLEAN NOT NULL DEFAULT true,
    `max_cuotas_producto` TINYINT NOT NULL DEFAULT 6,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',

    UNIQUE INDEX `producto_tienda_id_codigo_key`(`tienda_id`, `codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cliente` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tienda_id` BIGINT NOT NULL,
    `usuario_id` BIGINT NULL,
    `dni` CHAR(8) NOT NULL,
    `nombres` VARCHAR(80) NOT NULL,
    `apellidos` VARCHAR(80) NOT NULL,
    `direccion` VARCHAR(150) NULL,
    `telefono` VARCHAR(15) NULL,
    `moneda` ENUM('PEN', 'USD') NOT NULL DEFAULT 'PEN',
    `tasa_interes` DECIMAL(12, 7) NOT NULL,
    `periodo_tasa` ENUM('DIARIA', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL') NOT NULL,
    `tasa_mora` DECIMAL(12, 7) NOT NULL,
    `periodo_tasa_mora` ENUM('DIARIA', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL') NOT NULL,
    `limite_credito` DECIMAL(12, 2) NOT NULL,
    `max_cuotas` TINYINT NOT NULL,
    `dia_corte` TINYINT NOT NULL,
    `hora_corte` TIME(0) NOT NULL,
    `dia_pago` TINYINT NOT NULL,
    `acepta_privacidad` BOOLEAN NOT NULL DEFAULT false,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',

    UNIQUE INDEX `cliente_usuario_id_key`(`usuario_id`),
    UNIQUE INDEX `cliente_tienda_id_dni_key`(`tienda_id`, `dni`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `compra` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tienda_id` BIGINT NOT NULL,
    `cliente_id` BIGINT NOT NULL,
    `fecha_hora` DATETIME(3) NOT NULL,
    `capital_inicial` DECIMAL(12, 2) NOT NULL,
    `n_cuotas` TINYINT NOT NULL,
    `fecha_corte_ciclo` DATETIME(3) NOT NULL,
    `fecha_fin_gracia` DATE NOT NULL,
    `dias_gracia` INTEGER NOT NULL,
    `tasa_gracia` DECIMAL(18, 12) NOT NULL,
    `interes_gracia` DECIMAL(12, 2) NOT NULL,
    `capital_financiado` DECIMAL(12, 2) NOT NULL,
    `tem` DECIMAL(18, 12) NOT NULL,
    `cuota_regular` DECIMAL(12, 2) NOT NULL,
    `tea` DECIMAL(12, 7) NOT NULL,
    `estado` ENUM('VIGENTE', 'CANCELADA') NOT NULL DEFAULT 'VIGENTE',

    INDEX `compra_cliente_id_fecha_hora_idx`(`cliente_id`, `fecha_hora`),
    INDEX `compra_tienda_id_idx`(`tienda_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `detalle_compra` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `compra_id` BIGINT NOT NULL,
    `producto_id` BIGINT NOT NULL,
    `cantidad` DECIMAL(10, 3) NOT NULL,
    `precio_unitario_aplicado` DECIMAL(12, 2) NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,

    INDEX `detalle_compra_compra_id_idx`(`compra_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cuota` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `compra_id` BIGINT NOT NULL,
    `estado_cuenta_id` BIGINT NULL,
    `numero` TINYINT NOT NULL,
    `fecha_vencimiento` DATE NOT NULL,
    `saldo_inicial` DECIMAL(12, 2) NOT NULL,
    `interes` DECIMAL(12, 2) NOT NULL,
    `amortizacion` DECIMAL(12, 2) NOT NULL,
    `monto_cuota` DECIMAL(12, 2) NOT NULL,
    `saldo_final` DECIMAL(12, 2) NOT NULL,
    `estado` ENUM('PENDIENTE', 'PAGADA') NOT NULL DEFAULT 'PENDIENTE',

    INDEX `cuota_estado_fecha_vencimiento_idx`(`estado`, `fecha_vencimiento`),
    INDEX `cuota_estado_cuenta_id_idx`(`estado_cuenta_id`),
    UNIQUE INDEX `cuota_compra_id_numero_key`(`compra_id`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `estado_cuenta` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cliente_id` BIGINT NOT NULL,
    `fecha_corte` DATE NOT NULL,
    `fecha_pago` DATE NOT NULL,
    `total_capital` DECIMAL(12, 2) NOT NULL,
    `total_intereses_cuotas` DECIMAL(12, 2) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `estado` ENUM('PENDIENTE', 'PAGADO') NOT NULL DEFAULT 'PENDIENTE',

    UNIQUE INDEX `estado_cuenta_cliente_id_fecha_corte_key`(`cliente_id`, `fecha_corte`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `estado_cuenta_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `estado_cuenta_id` BIGINT NOT NULL,
    `cuota_id` BIGINT NULL,
    `tipo` ENUM('CUOTA', 'MORA') NOT NULL,
    `fecha` DATE NOT NULL,
    `descripcion` VARCHAR(150) NOT NULL,
    `capital` DECIMAL(12, 2) NOT NULL,
    `dias` INTEGER NULL,
    `tasa_periodo` DECIMAL(18, 12) NULL,
    `interes` DECIMAL(12, 2) NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,

    INDEX `estado_cuenta_item_estado_cuenta_id_idx`(`estado_cuenta_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pago` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `estado_cuenta_id` BIGINT NOT NULL,
    `fecha_pago_real` DATE NOT NULL,
    `dias_mora` INTEGER NOT NULL,
    `tasa_mora_periodo` DECIMAL(18, 12) NULL,
    `monto_mora` DECIMAL(12, 2) NOT NULL,
    `monto_interes` DECIMAL(12, 2) NOT NULL,
    `monto_capital` DECIMAL(12, 2) NOT NULL,
    `monto_total` DECIMAL(12, 2) NOT NULL,
    `medio_pago` ENUM('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA') NOT NULL,

    UNIQUE INDEX `pago_estado_cuenta_id_key`(`estado_cuenta_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `usuario` ADD CONSTRAINT `usuario_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES `tienda`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bitacora` ADD CONSTRAINT `bitacora_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `producto` ADD CONSTRAINT `producto_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES `tienda`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cliente` ADD CONSTRAINT `cliente_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES `tienda`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cliente` ADD CONSTRAINT `cliente_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compra` ADD CONSTRAINT `compra_tienda_id_fkey` FOREIGN KEY (`tienda_id`) REFERENCES `tienda`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `compra` ADD CONSTRAINT `compra_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `detalle_compra` ADD CONSTRAINT `detalle_compra_compra_id_fkey` FOREIGN KEY (`compra_id`) REFERENCES `compra`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `detalle_compra` ADD CONSTRAINT `detalle_compra_producto_id_fkey` FOREIGN KEY (`producto_id`) REFERENCES `producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuota` ADD CONSTRAINT `cuota_compra_id_fkey` FOREIGN KEY (`compra_id`) REFERENCES `compra`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuota` ADD CONSTRAINT `cuota_estado_cuenta_id_fkey` FOREIGN KEY (`estado_cuenta_id`) REFERENCES `estado_cuenta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `estado_cuenta` ADD CONSTRAINT `estado_cuenta_cliente_id_fkey` FOREIGN KEY (`cliente_id`) REFERENCES `cliente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `estado_cuenta_item` ADD CONSTRAINT `estado_cuenta_item_estado_cuenta_id_fkey` FOREIGN KEY (`estado_cuenta_id`) REFERENCES `estado_cuenta`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `estado_cuenta_item` ADD CONSTRAINT `estado_cuenta_item_cuota_id_fkey` FOREIGN KEY (`cuota_id`) REFERENCES `cuota`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pago` ADD CONSTRAINT `pago_estado_cuenta_id_fkey` FOREIGN KEY (`estado_cuenta_id`) REFERENCES `estado_cuenta`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
